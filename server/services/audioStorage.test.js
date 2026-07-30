const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPublicObjectUrl,
  getStoredAudioMetadata,
  getStoredAudioPublicUrl,
} = require("./audioStorage");

const withEnv = async (values, callback) => {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("buildPublicObjectUrl safely encodes every path segment", () => {
  assert.equal(
    buildPublicObjectUrl({
      supabaseUrl: "https://example.supabase.co/",
      bucket: "exam-audio",
      objectPath: "assets/audio file.mp3",
    }),
    "https://example.supabase.co/storage/v1/object/public/exam-audio/assets/audio%20file.mp3"
  );
});

test("stored metadata must be verified before it can be served", () => {
  assert.equal(getStoredAudioMetadata({ storage: { bucket: "exam-audio", path: "assets/a.mp3" } }), null);
  assert.deepEqual(
    getStoredAudioMetadata({
      storage: {
        provider: "supabase",
        bucket: "exam-audio",
        path: "assets/a.mp3",
        sha256: "ABC",
        byteSize: 12,
        verified: true,
      },
    }),
    {
      provider: "supabase",
      bucket: "exam-audio",
      path: "assets/a.mp3",
      publicUrl: "",
      sha256: "abc",
      byteSize: 12,
      verified: true,
      verifiedAt: null,
    }
  );
});

test("database playback remains the default until the serve switch is enabled", async () => {
  const config = {
    storage: {
      bucket: "exam-audio",
      path: "assets/a.mp3",
      publicUrl: "https://cdn.example.test/a.mp3",
      verified: true,
    },
  };
  await withEnv({ AUDIO_STORAGE_SERVE_OBJECTS: undefined }, async () => {
    assert.equal(getStoredAudioPublicUrl(config), "");
  });
  await withEnv({ AUDIO_STORAGE_SERVE_OBJECTS: "true" }, async () => {
    assert.equal(getStoredAudioPublicUrl(config), "https://cdn.example.test/a.mp3");
  });
});
