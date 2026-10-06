import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectDevelopmentProvider as inspectDevelopmentProviderRuntime,
} from "./development-provider-runtime.mjs";
import { inspectProvider as inspectProviderRuntime } from "./provider-runtime.mjs";
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

const PROVIDER_ACTIONS = {
  "provider-not-prepared": "provider-prepare-required",
  "provider-ready": "provider-run-required",
  "provider-run-in-progress": "provider-run-in-progress",
  "provider-failed": "provider-retry-decision",
  "provider-materialize-required": "provider-materialize-required",
  "provider-execution-indeterminate": "provider-indeterminate-materialization-required",
  "provider-invalid": "provider-invalid",
  "provider-materialized": "apply-result",
};

const DEVELOPMENT_PROVIDER_ACTIONS = {
  "development-worktree-required": "development-worktree-required",
  "development-provider-not-prepared": "development-provider-prepare-required",
  "development-provider-ready": "development-provider-run-required",
  "development-provider-run-in-progress": "development-provider-run-in-progress",
  "development-provider-materialize-required": "development-provider-materialize-required",
  "development-provider-test-required": "development-provider-test-required",
  "adapter-selection-required": "adapter-selection-required",
  "development-provider-finalize-required": "development-provider-finalize-required",
  "development-provider-ready-for-integration": "development-provider-ready-for-integration",
  "development-provider-failed": "development-provider-retry-decision",
  "development-provider-indeterminate": "development-provider-recovery-required",
  "development-provider-recovery-required": "development-provider-recovery-required",
  "development-provider-invalid": "development-provider-invalid",
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

function hasSingleDevelopmentTask(state) {
  const pending = (state.dag?.nodes ?? []).filter((node) => node.status === "pending");
  return pending.length === 1
    && ["backend-developer", "frontend-developer"].includes(pending[0].ownerAgent);
}

export async function runE2ECommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const runStory = options.runStory ?? runStoryCommand;
  const inspectProvider = options.inspectProvider ?? inspectProviderRuntime;
  const inspectDevelopmentProvider = options.inspectDevelopmentProvider
    ?? inspectDevelopmentProviderRuntime;
  const storyOptions = { root, stateFile: options.stateFile };
  const inspect = async () => {
    const story = await runStory({ ...storyOptions, command: "inspect" });
    const result = actionResult(story);
    if (story.inspection.status !== "awaiting-result") {
      return result;
    }
    if (story.state.phase === "code-review") {
      const providerInspection = await inspectProvider({
        root,
        stateFile: story.stateFile,
      });
      const action = PROVIDER_ACTIONS[providerInspection.status];
      if (!action) {
        throw new Error(`Unsupported Provider inspection status: ${providerInspection.status ?? "(missing)"}`);
      }
      return {
        ...result,
        action,
        providerInspection,
      };
    }
    if (story.state.phase === "implementation" && hasSingleDevelopmentTask(story.state)) {
      const developmentProviderInspection = await inspectDevelopmentProvider({
        root,
        stateFile: story.stateFile,
      });
      const action = DEVELOPMENT_PROVIDER_ACTIONS[developmentProviderInspection.status];
      if (!action) {
        throw new Error(
          `Unsupported Development Provider inspection status: ${
            developmentProviderInspection.status ?? "(missing)"
          }`,
        );
      }
      return {
        ...result,
        action,
        developmentProviderInspection,
      };
    }
    return result;
  };
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
