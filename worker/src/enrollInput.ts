// Where the enrollment code comes from, in order: the command-line argument, the standard input when the argument is `-`
// (nothing left in `ps` or shell history), the WORKER_ENROLL_CODE environment variable. Blank counts as absent.
export async function readEnrollCode(
  args: string[],
  env: NodeJS.ProcessEnv,
  readStdin: () => Promise<string>,
): Promise<string | undefined> {
  const argument = args[0]?.trim();

  if (argument === '-') {
    return (await readStdin()).trim() || undefined;
  }

  return argument || env.WORKER_ENROLL_CODE?.trim() || undefined;
}
