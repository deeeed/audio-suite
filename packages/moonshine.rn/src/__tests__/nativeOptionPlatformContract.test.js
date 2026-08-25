const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..', '..');

test('forwards external diarization models only to Android 0.1.5', () => {
  const android = fs.readFileSync(
    path.join(
      packageRoot,
      'android/src/main/java/net/siteed/moonshine/MoonshineModule.kt'
    ),
    'utf8'
  );
  const ios = fs.readFileSync(
    path.join(packageRoot, 'ios/Moonshine.mm'),
    'utf8'
  );

  expect(android).toContain(
    'TranscriberOption("diarization_model_dir", it.getString("diarizationModelDir"))'
  );
  expect(ios).not.toContain('addOption(@"diarization_model_dir"');
});
