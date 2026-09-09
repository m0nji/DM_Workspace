// The sandboxed preload cannot import os. Main supplies the real OS build.
export const WINDOWS_BUILD_FLAG = '--dmws-windows-build=';

export function windowsBuildFromArgv(argv: readonly string[]): number | undefined {
  const value = argv.find(a => a.startsWith(WINDOWS_BUILD_FLAG))?.slice(WINDOWS_BUILD_FLAG.length);
  if (!value || !/^\d+$/.test(value)) return undefined;
  const build = Number(value);
  return Number.isSafeInteger(build) && build > 0 ? build : undefined;
}
