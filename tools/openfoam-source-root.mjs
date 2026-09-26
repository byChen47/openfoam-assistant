'use strict';

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIRECTORY_NAME = 'OpenFOAM-v2606';
const VERSIONED_DIRECTORY_RE = /^OpenFOAM-v\d/;

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  }
  catch {
    return false;
  }
}

function versionedCandidates(projectRoot) {
  return fs.readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSIONED_DIRECTORY_RE.test(entry.name))
    .map((entry) => path.join(projectRoot, entry.name))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Resolve the OpenFOAM source tree used as the extraction corpus.
 *
 * Resolution order:
 *   1. OPENFOAM_SOURCE_ROOT environment variable
 *   2. <projectRoot>/OpenFOAM-v2606
 *   3. a single OpenFOAM-v* directory next to the project
 *
 * The corpus is intentionally not committed, so an explicit, actionable error
 * is raised instead of failing later on a missing subdirectory.
 */
function resolveOpenFoamRoot(projectRoot) {
  const fromEnvironment = (process.env.OPENFOAM_SOURCE_ROOT || '').trim();
  if (fromEnvironment) {
    const resolved = path.resolve(fromEnvironment);
    if (!isDirectory(resolved)) {
      throw new Error(`OPENFOAM_SOURCE_ROOT is not a directory: ${resolved}`);
    }
    return resolved;
  }

  const preferred = path.join(projectRoot, DEFAULT_DIRECTORY_NAME);
  if (isDirectory(preferred)) {
    return preferred;
  }

  const candidates = versionedCandidates(projectRoot);
  if (candidates.length === 1) {
    return candidates[0];
  }

  const hint = candidates.length > 1
    ? `Found several candidates: ${candidates.map((item) => path.basename(item)).join(', ')}. Set OPENFOAM_SOURCE_ROOT to choose one.`
    : `Place an OpenFOAM source checkout at ${preferred}, or point OPENFOAM_SOURCE_ROOT at one.`;

  throw new Error(
    `OpenFOAM source tree not found under ${projectRoot}. ${hint} `
    + 'The corpus is not committed to this repository; see the "Regenerate keyword data" section of README.md.',
  );
}

export { resolveOpenFoamRoot };
