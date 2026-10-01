import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
await fs.mkdir(path.join(root, 'public'), { recursive: true });
await fs.copyFile(path.join(root, 'engine/trade-scorer/target/wasm32-unknown-unknown/release/trade_scorer.wasm'), path.join(root, 'public/trade-scorer-v1.wasm'));
console.log('Updated public/trade-scorer-v1.wasm');
