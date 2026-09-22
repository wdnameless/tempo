import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const refPath = 'D:/WORK/.refs/handy/src-tauri/src/catalog/catalog.json';
const outPath = path.join(rootDir, 'src-tauri/src/stt/catalog.json');

try {
  const raw = fs.readFileSync(refPath, 'utf8');
  const handyCat = JSON.parse(raw);

  const whispers = handyCat.models.filter(m => m.family === 'whisper');

  const models = whispers.map(m => ({
    id: m.id,
    revision: m.revision,
    slug: m.slug,
    name: m.name,
    architecture: m.architecture,
    family: m.family,
    parameters: m.parameters,
    description: m.description,
    language_count: m.language_count,
    languages: m.languages,
    capabilities: {
      streaming: m.capabilities?.streaming ?? false,
      translate: m.capabilities?.translate ?? false,
      lang_detect: m.capabilities?.lang_detect ?? false,
      timestamps: m.capabilities?.timestamps ?? 'none',
    },
    speed_score: m.speed_score,
    accuracy_score: m.accuracy_score,
    files: m.files.map(f => ({
      filename: f.filename,
      quant: f.quant,
      size_bytes: f.size_bytes,
      sha256: f.sha256,
    })),
    default_quant: m.default_quant,
    recommended: m.recommended ?? false,
    recommended_rank: m.recommended_rank ?? null,
  }));

  const catalog = {
    catalog_version: 2,
    mirrors: handyCat.mirrors || ['https://blob.handy.computer'],
    models,
  };

  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`Generated ${outPath}: ${models.length} models, ${models.reduce((acc, m) => acc + m.files.length, 0)} files`);
} catch (err) {
  console.error('Failed to generate catalog.json:', err);
  process.exit(1);
}
