import { runCli } from "../src/cli/ingest";

process.exitCode = await runCli(process.env, console);
