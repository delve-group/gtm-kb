import path from 'node:path';
import { BrainKernel } from '../brain/index.js';

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const requestedRoot = process.argv[2] ?? process.env.BRAIN_ROOT ?? 'brain';
  const brain = new BrainKernel({
    rootDir: path.resolve(repositoryRoot, requestedRoot),
    repositoryRoot,
  });
  await brain.refresh();
  const report = brain.validate();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Validation failed unexpectedly.';
  process.stderr.write(`${JSON.stringify({ error: 'VALIDATION_FAILED', message })}\n`);
  process.exitCode = 1;
});
