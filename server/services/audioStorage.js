const crypto = require("crypto");

const DEFAULT_BUCKET = "exam-audio";

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const asBoolean = (value) => /^(?:1|true|yes|on)$/i.test(String(value || "").trim());

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/$/, "");

const encodeObjectPath = (value) =>
  String(value || "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

const getAudioStorageSettings = () => ({
  supabaseUrl: normalizeBaseUrl(process.env.SUPABASE_URL),
  serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  bucket: String(process.env.AUDIO_STORAGE_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET,
  uploadEnabled: asBoolean(process.env.AUDIO_STORAGE_UPLOAD_ENABLED),
  serveObjects: asBoolean(process.env.AUDIO_STORAGE_SERVE_OBJECTS),
  required: asBoolean(process.env.AUDIO_STORAGE_REQUIRED),
});

const getStoredAudioMetadata = (audioConfig) => {
  const storage = asObject(asObject(audioConfig).storage);
  const bucket = String(storage.bucket || "").trim();
  const objectPath = String(storage.path || storage.objectPath || "").trim();
  const publicUrl = normalizeBaseUrl(storage.publicUrl);
  if (!bucket || !objectPath || storage.verified !== true) return null;
  return {
    provider: String(storage.provider || "supabase").trim(),
    bucket,
    path: objectPath,
    publicUrl,
    sha256: String(storage.sha256 || "").trim().toLowerCase(),
    byteSize: Number(storage.byteSize) || 0,
    verified: true,
    verifiedAt: storage.verifiedAt || null,
  };
};

const buildPublicObjectUrl = ({ supabaseUrl, bucket, objectPath }) => {
  const base = normalizeBaseUrl(supabaseUrl);
  if (!base || !bucket || !objectPath) return "";
  return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
};

const getStoredAudioPublicUrl = (audioConfig, { ignoreServeFlag = false } = {}) => {
  const storage = getStoredAudioMetadata(audioConfig);
  if (!storage) return "";
  const settings = getAudioStorageSettings();
  if (!ignoreServeFlag && !settings.serveObjects) return "";
  return storage.publicUrl || buildPublicObjectUrl({
    supabaseUrl: settings.supabaseUrl,
    bucket: storage.bucket,
    objectPath: storage.path,
  });
};

const uploadAudioBuffer = async ({ buffer, mimeType = "audio/mpeg" }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Audio storage upload requires a non-empty buffer.");
  }

  const settings = getAudioStorageSettings();
  if (!settings.uploadEnabled) return null;
  if (!settings.supabaseUrl || !settings.serviceRoleKey || !settings.bucket) {
    throw new Error("Audio object storage is enabled but not fully configured.");
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const objectPath = `assets/${sha256}.mp3`;
  const uploadUrl = `${settings.supabaseUrl}/storage/v1/object/${encodeURIComponent(settings.bucket)}/${encodeObjectPath(objectPath)}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: settings.serviceRoleKey,
      authorization: `Bearer ${settings.serviceRoleKey}`,
      "cache-control": "max-age=31536000",
      "content-type": mimeType || "audio/mpeg",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Audio object upload failed (${response.status}): ${details.slice(0, 240)}`);
  }

  const publicUrl = buildPublicObjectUrl({
    supabaseUrl: settings.supabaseUrl,
    bucket: settings.bucket,
    objectPath,
  });
  const verification = await fetch(publicUrl, { method: "HEAD", cache: "no-store" });
  const storedSize = Number(verification.headers.get("content-length")) || 0;
  if (!verification.ok || storedSize !== buffer.length) {
    throw new Error(`Audio object verification failed (${verification.status}, ${storedSize}/${buffer.length} bytes).`);
  }

  return {
    provider: "supabase",
    bucket: settings.bucket,
    path: objectPath,
    publicUrl,
    sha256,
    byteSize: buffer.length,
    verified: true,
    verifiedAt: new Date().toISOString(),
  };
};

module.exports = {
  buildPublicObjectUrl,
  getAudioStorageSettings,
  getStoredAudioMetadata,
  getStoredAudioPublicUrl,
  uploadAudioBuffer,
};
