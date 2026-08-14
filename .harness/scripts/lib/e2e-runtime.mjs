import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStoryCommand } from "./story-runtime.mjs";

const ACTIONS = {
  "not-prepared": "prepare",
  "awaiting-result": "cognitive-action-required",
  "adapter-required": "adapter-selection-required",
  "result-ready": "apply-result",
  "recovery-required": "apply-result",
  "knowledge-refresh-required": "knowledge-refresh-required",
  "approval-required": "approval-required",
  "failed-result": "failed-result",
  "result-invalid": "cognitive-action-required",
  blocked: "blocked",
  completed: "completed",
};

function actionResult(story) {
  const action = ACTIONS[story.inspection?.status];
  if (!action) throw new Error(`Unsupported dispatch inspection status: ${story.inspection?.status ?? "(missing)"}`);
  return {
    schemaVersion: "1.0",
    command: "status",
    storyId: story.state.storyId,
    runId: story.state.runtime.runId,
    stateFile: story.stateFile,
    phase: story.state.phase,
    stateStatus: story.state.runtime.status,
    revision: story.state.runtime.revision,
    action,
    inspection: story.inspection,
  };
}

export async function runE2ECommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const runStory = options.runStory ?? runStoryCommand;
  const storyOptions = { root, stateFile: options.stateFile };
  const inspect = async () => actionResult(await runStory({ ...storyOptions, command: "inspect" }));
  const current = await inspect();

  if (options.command === "status") return current;
  if (options.command === "step") {
    if (current.action === "prepare") {
      await runStory({ ...storyOptions, command: "prepare" });
      return inspect();
    }
    if (current.action === "apply-result") {
      await runStory({ ...storyOptions, command: "apply" });
      return inspect();
    }
    return current;
  }
  if (options.command === "apply") {
    if (current.action !== "apply-result") {
      throw new Error(`Current dispatch result is not ready to apply: ${current.inspection.status}.`);
    }
    await runStory({ ...storyOptions, command: "apply" });
    return inspect();
  }
  throw new Error(`Unsupported E2E command: ${options.command ?? "(missing)"}`);
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    const key = token === "--root" ? "root" : token === "--state-file" ? "stateFile" : null;
    if (!key || index + 1 >= tokens.length) throw new Error(`Unsupported or incomplete argument: ${token}`);
    options[key] = tokens[index + 1];
    index += 1;
  }
  return options;
}

async function runCli() {
  let options = {};
  try {
    options = parseCliArguments(process.argv.slice(2));
    const result = await runE2ECommand(options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`E2E action '${result.action}' for ${result.storyId} phase '${result.phase}'.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.error(JSON.stringify({ error: message }));
    else console.error(`E2E command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
