import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface PostProcessResult {
  writtenFiles: string[];
  skippedFiles: string[];
  cleanedFiles: string[];
  errors: string[];
}

/**
 * Converts a string (e.g., snake_case or kebab-case) into PascalCase/CamelCase.
 */
export function toCamelCase(str: string): string {
  if (!str) return '';
  const parts = str.split(/[_\-/]/);
  let result = '';
  for (const part of parts) {
    if (part.length > 0) {
      result += part.charAt(0).toUpperCase() + part.slice(1);
    }
  }
  return result;
}

/**
 * Converts a string (e.g., PascalCase or CamelCase) into snake_case.
 */
export function toSnakeCase(str: string): string {
  if (!str) return '';
  let s = str.replace(/(.)([A-Z])/g, '$1_$2').toLowerCase();
  s = s.replace(/[\s\-/]+/g, '_');
  s = s.replace(/_+/g, '_');
  if (s.startsWith('_')) {
    s = s.slice(1);
  }
  if (s.endsWith('_')) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * Recursively scans a directory for relative file paths.
 */
export async function scanExistingFiles(dir: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const sub = await scanExistingFiles(path.join(dir, entry.name), relPath);
        result.push(...sub);
      } else if (entry.isFile()) {
        result.push(relPath);
      }
    }
  } catch {
    // Directory might not exist yet
  }
  return result;
}

/**
 * Automatically prunes opposite-language source and runner files for a specific node
 * when switching between C++ and Python implementations to prevent duplicate/lingering nodes.
 */
export async function cleanOppositeLanguageFiles(
  srcGenDir: string,
  pkgName: string,
  node: { artifactName: string; nodeName: string },
  targetLanguage: 'cpp' | 'python'
): Promise<string[]> {
  const cleaned: string[] = [];
  const pkgDir = path.join(srcGenDir, pkgName);

  if (targetLanguage === 'cpp') {
    const snakeNames = new Set([
      toSnakeCase(node.nodeName),
      toSnakeCase(node.artifactName),
    ]);
    for (const s of snakeNames) {
      if (!s) continue;
      const files = [
        path.join(pkgDir, pkgName, `${s}_wrapper.py`),
        path.join(pkgDir, pkgName, `${s}_runner.py`),
        path.join(pkgDir, pkgName, `${s}_logic.py`),
      ];
      for (const f of files) {
        if (fs.existsSync(f)) {
          try {
            await fsp.unlink(f);
            cleaned.push(f);
          } catch {
            // Ignore
          }
        }
      }
    }
    // If no other .py files remain in <pkgName>/<pkgName>, remove python package folder
    try {
      const pyPkgDir = path.join(pkgDir, pkgName);
      if (fs.existsSync(pyPkgDir)) {
        const entries = await fsp.readdir(pyPkgDir);
        const hasOtherPy = entries.some(n => n.endsWith('.py') && n !== '__init__.py');
        if (!hasOtherPy) {
          await fsp.rm(pyPkgDir, { recursive: true, force: true });
          cleaned.push(pyPkgDir);
        }
      }
    } catch {
      // Ignore
    }
  } else if (targetLanguage === 'python') {
    const camelNames = new Set([
      toCamelCase(node.artifactName),
      toCamelCase(node.nodeName),
    ]);
    for (const c of camelNames) {
      if (!c) continue;
      const files = [
        path.join(pkgDir, 'include', pkgName, `${c}Wrapper.hpp`),
        path.join(pkgDir, 'include', pkgName, `${c}Node.hpp`),
        path.join(pkgDir, 'include', pkgName, `${c}Algorithm.hpp`),
        path.join(pkgDir, 'src', `${c}Wrapper.cpp`),
        path.join(pkgDir, 'src', `${c}Node.cpp`),
        path.join(pkgDir, 'src', `${c}Runner.cpp`),
      ];
      for (const f of files) {
        if (fs.existsSync(f)) {
          try {
            await fsp.unlink(f);
            cleaned.push(f);
          } catch {
            // Ignore
          }
        }
      }
    }
    // If include/<pkgName> or src is empty, remove them
    try {
      const incPkgDir = path.join(pkgDir, 'include', pkgName);
      if (fs.existsSync(incPkgDir)) {
        const entries = await fsp.readdir(incPkgDir);
        if (entries.length === 0) {
          await fsp.rmdir(incPkgDir);
          const incDir = path.join(pkgDir, 'include');
          const incEntries = await fsp.readdir(incDir);
          if (incEntries.length === 0) {
            await fsp.rmdir(incDir);
          }
        }
      }
    } catch {
      // Ignore
    }
    try {
      const srcDir = path.join(pkgDir, 'src');
      if (fs.existsSync(srcDir)) {
        const entries = await fsp.readdir(srcDir);
        if (entries.length === 0) {
          await fsp.rmdir(srcDir);
        }
      }
    } catch {
      // Ignore
    }
  }
  return cleaned;
}

/**
 * Automatically prunes redundant build and setup files when switching between
 * pure Python (ament_python) and C++ / Hybrid (ament_cmake / ament_cmake_python) packages.
 */
export async function cleanRedundantBuildFiles(
  srcGenDir: string,
  pkgName: string,
  isCMakePackage: boolean
): Promise<string[]> {
  const cleaned: string[] = [];
  const pkgDir = path.join(srcGenDir, pkgName);

  if (isCMakePackage) {
    const filesToDelete = [
      path.join(pkgDir, 'setup.py'),
      path.join(pkgDir, 'setup.cfg'),
      path.join(pkgDir, 'pyproject.toml'),
      path.join(pkgDir, 'resource', pkgName),
    ];
    for (const f of filesToDelete) {
      if (fs.existsSync(f)) {
        try {
          await fsp.unlink(f);
          cleaned.push(f);
        } catch {
          // Ignore
        }
      }
    }
    // Delete resource directory ONLY IF it is empty (preserving .puml diagrams)
    try {
      const resourceDir = path.join(pkgDir, 'resource');
      if (fs.existsSync(resourceDir)) {
        const entries = await fsp.readdir(resourceDir);
        if (entries.length === 0) {
          await fsp.rmdir(resourceDir);
          cleaned.push(resourceDir);
        }
      }
    } catch {
      // Ignore
    }
  } else {
    const filesToDelete = [
      path.join(pkgDir, 'CMakeLists.txt'),
      path.join(pkgDir, 'pyproject.toml'),
    ];
    for (const f of filesToDelete) {
      if (fs.existsSync(f)) {
        try {
          await fsp.unlink(f);
          cleaned.push(f);
        } catch {
          // Ignore
        }
      }
    }
  }
  return cleaned;
}

/**
 * Ensures that CMakeLists.txt contains installation directives for launch/ and config/.
 */
export async function ensureLaunchInstallInCMake(srcGenDir: string, pkgName: string): Promise<boolean> {
  const cmakePath = path.join(srcGenDir, pkgName, 'CMakeLists.txt');
  if (!fs.existsSync(cmakePath)) {
    return false;
  }
  try {
    let cmakeContent = await fsp.readFile(cmakePath, 'utf-8');
    const launchInstallSnippet = `install(DIRECTORY launch
  DESTINATION share/\${PROJECT_NAME}
  OPTIONAL
)

install(DIRECTORY config
  DESTINATION share/\${PROJECT_NAME}
  OPTIONAL
)`;

    if (cmakeContent.includes('if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/launch")')) {
      cmakeContent = cmakeContent.replace(
        /if\(EXISTS\s+"\$\{CMAKE_CURRENT_SOURCE_DIR\}\/launch"\)[\s\S]*?endif\(\)(\s*if\(EXISTS\s+"\$\{CMAKE_CURRENT_SOURCE_DIR\}\/config"\)[\s\S]*?endif\(\))?/,
        launchInstallSnippet
      );
      await fsp.writeFile(cmakePath, cmakeContent, 'utf-8');
      return true;
    }

    const hasLaunchInstall =
      cmakeContent.includes('install(DIRECTORY launch') ||
      cmakeContent.includes('DIRECTORY launch') ||
      cmakeContent.includes('install(DIRECTORY\n  launch');

    if (!hasLaunchInstall && cmakeContent.includes('ament_package()')) {
      cmakeContent = cmakeContent.replace('ament_package()', `${launchInstallSnippet}\n\nament_package()`);
      await fsp.writeFile(cmakePath, cmakeContent, 'utf-8');
      return true;
    }
  } catch {
    // Ignore
  }
  return false;
}

/**
 * Ensures that package.xml contains dependencies for launch, launch_ros, and ament_index_python.
 */
export async function ensureLaunchDepsInPackageXml(srcGenDir: string, pkgName: string): Promise<boolean> {
  const pkgXmlPath = path.join(srcGenDir, pkgName, 'package.xml');
  if (!fs.existsSync(pkgXmlPath)) {
    return false;
  }
  try {
    let pkgXmlContent = await fsp.readFile(pkgXmlPath, 'utf-8');
    if (!pkgXmlContent.includes('<exec_depend>launch</exec_depend>') && pkgXmlContent.includes('</package>')) {
      const launchDeps = `  <exec_depend>ament_index_python</exec_depend>
  <exec_depend>launch</exec_depend>
  <exec_depend>launch_ros</exec_depend>
</package>`;
      pkgXmlContent = pkgXmlContent.replace('</package>', launchDeps);
      await fsp.writeFile(pkgXmlPath, pkgXmlContent, 'utf-8');
      return true;
    }
  } catch {
    // Ignore
  }
  return false;
}

/**
 * Processes and writes generated files to srcGenDir while enforcing overwrite protections
 * and cleaning build configurations.
 */
export async function processAndWriteFiles(
  srcGenDir: string,
  files: Record<string, string>,
  isSystemGeneration = false
): Promise<PostProcessResult> {
  const result: PostProcessResult = {
    writtenFiles: [],
    skippedFiles: [],
    cleanedFiles: [],
    errors: [],
  };

  const affectedPkgs = new Set<string>();

  for (const rawPath of Object.keys(files)) {
    const cleanPath = rawPath.replace(/^DEFAULT_OUTPUT\/?/, '');
    const pkg = cleanPath.split('/')[0];
    if (pkg) {
      affectedPkgs.add(pkg);
    }
  }

  // Pre-clean redundant build files per package
  for (const pkg of affectedPkgs) {
    const pkgDir = path.join(srcGenDir, pkg);
    let hasExistingCMake = false;
    let hasExistingCpp = false;
    let hasExistingSetup = false;

    if (fs.existsSync(pkgDir)) {
      try {
        const entries = await fsp.readdir(pkgDir);
        hasExistingCMake = entries.includes('CMakeLists.txt');
        hasExistingCpp = entries.includes('src');
        hasExistingSetup = entries.includes('setup.py');
      } catch {
        // Ignore
      }
    }

    const hasCMakeInFiles = Object.keys(files).some(k => {
      const cp = k.replace(/^DEFAULT_OUTPUT\/?/, '');
      return cp === `${pkg}/CMakeLists.txt`;
    });

    const isPurePython = hasExistingSetup && !hasExistingCpp && !hasExistingCMake && !hasCMakeInFiles;
    const cleaned = await cleanRedundantBuildFiles(srcGenDir, pkg, !isPurePython);
    result.cleanedFiles.push(...cleaned);
  }

  // Write files with overwrite protections
  for (const [rawPath, content] of Object.entries(files)) {
    const cleanPath = rawPath.replace(/^DEFAULT_OUTPUT\/?/, '');
    const filePath = path.join(srcGenDir, cleanPath);
    const pkgName = cleanPath.split('/')[0];
    const pkgDir = path.join(srcGenDir, pkgName);

    // Rule 1: User domain logic starter files are generated once and NEVER overwritten
    if (cleanPath.endsWith('Algorithm.hpp') || cleanPath.endsWith('_logic.py')) {
      if (fs.existsSync(filePath)) {
        result.skippedFiles.push(cleanPath);
        continue;
      }
    }

    // Rule 2: Overwrite protections for existing node wrapper packages in rossystem generation
    if (isSystemGeneration) {
      if (cleanPath.endsWith('CMakeLists.txt')) {
        if (fs.existsSync(filePath)) {
          try {
            const existingText = await fsp.readFile(filePath, 'utf-8');
            if (existingText.includes('add_library') || existingText.includes('add_executable')) {
              result.skippedFiles.push(cleanPath);
              continue;
            }
          } catch {
            // Ignore
          }
        }
        // Skip CMakeLists.txt if target package is pure Python
        if (fs.existsSync(pkgDir)) {
          try {
            const entries = await fsp.readdir(pkgDir);
            if (entries.includes('setup.py') && !entries.includes('src')) {
              result.skippedFiles.push(cleanPath);
              continue;
            }
          } catch {
            // Ignore
          }
        }
      }

      if (cleanPath.endsWith('setup.py') && fs.existsSync(filePath)) {
        try {
          const existingText = await fsp.readFile(filePath, 'utf-8');
          if (existingText.includes('console_scripts')) {
            result.skippedFiles.push(cleanPath);
            continue;
          }
        } catch {
          // Ignore
        }
      }

      if (cleanPath.endsWith('package.xml') && fs.existsSync(filePath)) {
        try {
          const existingText = await fsp.readFile(filePath, 'utf-8');
          if (existingText.includes('<depend>') || existingText.includes('<buildtool_depend>')) {
            result.skippedFiles.push(cleanPath);
            continue;
          }
        } catch {
          // Ignore
        }
      }
    }

    // Rule 3: Skip Python setuptools resource marker for CMake packages (always preserve .puml)
    if (cleanPath === `${pkgName}/resource/${pkgName}`) {
      const hasCMakeInFiles = Object.keys(files).some(k => k.replace(/^DEFAULT_OUTPUT\/?/, '') === `${pkgName}/CMakeLists.txt`);
      let isCMake = hasCMakeInFiles;
      if (!isCMake && fs.existsSync(pkgDir)) {
        try {
          const entries = await fsp.readdir(pkgDir);
          isCMake = entries.includes('CMakeLists.txt') || entries.includes('src');
        } catch {
          // Ignore
        }
      }
      if (isCMake) {
        result.skippedFiles.push(cleanPath);
        continue;
      }
    }

    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, content, 'utf-8');
      result.writtenFiles.push(cleanPath);
    } catch (err) {
      result.errors.push(`Failed to write ${cleanPath}: ${err}`);
    }
  }

  // Ensure launch installs and dependencies
  for (const pkg of affectedPkgs) {
    await ensureLaunchInstallInCMake(srcGenDir, pkg);
    await ensureLaunchDepsInPackageXml(srcGenDir, pkg);
  }

  return result;
}
