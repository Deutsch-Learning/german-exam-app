const corsHeaders = {
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-origin": "*",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

const bytesFromPostgresBytea = (value: unknown) => {
  const raw = String(value || "");
  const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error("The source audio is not a valid PostgreSQL bytea value.");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
};

const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const serviceFetch = (url: string, serviceRoleKey: string, init: RequestInit = {}) =>
  fetch(url, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      ...(init.headers || {}),
    },
  });

const getJwtRole = (authorization: string) => {
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return String(decoded?.role || "");
  } catch {
    return "";
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceRoleKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.replace(/^Bearer\s+/i, "");
  const isServiceRequest = suppliedToken === serviceRoleKey || getJwtRole(authorization) === "service_role";
  if (!serviceRoleKey || !isServiceRequest) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  try {
    const body = await request.json();
    const assetId = Number(body?.assetId);
    const commitMetadata = body?.commitMetadata !== false;
    if (!Number.isInteger(assetId) || assetId <= 0) return json({ ok: false, error: "Invalid asset id" }, 400);

    const bucket = "exam-audio";
    const bucketLookup = await serviceFetch(`${supabaseUrl}/storage/v1/bucket/${bucket}`, serviceRoleKey);
    if (bucketLookup.status === 400 || bucketLookup.status === 404) {
      const createBucket = await serviceFetch(`${supabaseUrl}/storage/v1/bucket`, serviceRoleKey, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: true,
          file_size_limit: 10485760,
          allowed_mime_types: ["audio/mpeg"],
        }),
      });
      if (!createBucket.ok && createBucket.status !== 409) {
        throw new Error(`Bucket creation failed (${createBucket.status}).`);
      }
    } else if (!bucketLookup.ok) {
      throw new Error(`Bucket lookup failed (${bucketLookup.status}).`);
    }

    const select = encodeURIComponent("id,content_hash,mime_type,audio_data,byte_size,audio_config,status");
    const sourceResponse = await serviceFetch(
      `${supabaseUrl}/rest/v1/exam_audio_assets?id=eq.${assetId}&select=${select}`,
      serviceRoleKey
    );
    if (!sourceResponse.ok) throw new Error(`Source lookup failed (${sourceResponse.status}).`);
    const [asset] = await sourceResponse.json();
    if (!asset || asset.status !== "ready" || !asset.audio_data) {
      return json({ ok: false, assetId, error: "Ready source audio was not found." }, 404);
    }

    const sourceBytes = bytesFromPostgresBytea(asset.audio_data);
    if (Number(asset.byte_size) !== sourceBytes.byteLength) {
      throw new Error(`Source size mismatch (${asset.byte_size}/${sourceBytes.byteLength}).`);
    }
    const sourceSha256 = await sha256Hex(sourceBytes);
    const objectPath = `assets/${sourceSha256}.mp3`;
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const uploadResponse = await serviceFetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`,
      serviceRoleKey,
      {
        method: "POST",
        headers: {
          "cache-control": "max-age=31536000",
          "content-type": asset.mime_type || "audio/mpeg",
          "x-upsert": "true",
        },
        body: sourceBytes,
      }
    );
    if (!uploadResponse.ok) {
      const details = await uploadResponse.text().catch(() => "");
      throw new Error(`Storage upload failed (${uploadResponse.status}): ${details.slice(0, 200)}`);
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`;
    const verifyResponse = await fetch(publicUrl, { cache: "no-store" });
    if (!verifyResponse.ok) throw new Error(`Storage verification download failed (${verifyResponse.status}).`);
    const storedBytes = new Uint8Array(await verifyResponse.arrayBuffer());
    const storedSha256 = await sha256Hex(storedBytes);
    if (storedBytes.byteLength !== sourceBytes.byteLength || storedSha256 !== sourceSha256) {
      throw new Error("Stored object checksum verification failed.");
    }

    const verifiedAt = new Date().toISOString();
    if (commitMetadata) {
      const audioConfig = asset.audio_config && typeof asset.audio_config === "object" ? asset.audio_config : {};
      const updateResponse = await serviceFetch(
        `${supabaseUrl}/rest/v1/exam_audio_assets?id=eq.${assetId}`,
        serviceRoleKey,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", prefer: "return=minimal" },
          body: JSON.stringify({
            audio_config: {
              ...audioConfig,
              storage: {
                provider: "supabase",
                bucket,
                path: objectPath,
                publicUrl,
                sha256: sourceSha256,
                byteSize: sourceBytes.byteLength,
                verified: true,
                verifiedAt,
              },
            },
          }),
        }
      );
      if (!updateResponse.ok) throw new Error(`Metadata update failed (${updateResponse.status}).`);
    }

    return json({
      ok: true,
      assetId,
      byteSize: sourceBytes.byteLength,
      sha256: sourceSha256,
      path: objectPath,
      metadataCommitted: commitMetadata,
    });
  } catch (error) {
    console.error("Audio migration failed", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Migration failed" }, 500);
  }
});
