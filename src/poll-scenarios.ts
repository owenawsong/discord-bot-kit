import { runScenario, type Scenario } from "./workflow.js";
import type { Bot } from "./types.js";
export const pollScenario: Scenario = {
  name: "Persistent poll workflow",
  steps: [
    {
      name: "poll create",
      args: { question: "Choose a genre", answers: "Jazz | Ambient | Pop" },
      saveAs: "created",
      expect: { clean: true, exact: { "/state/namespaces/polls/version": 1 } },
    },
    {
      name: "poll:vote:${created#/events/1/data/data/pollId}",
      kind: "select",
      values: ["0"],
      saveAs: "voted",
      expect: {
        clean: true,
        exact: {
          "/state/namespaces/polls/guilds/workshop-guild/polls/poll-1/votes": {
            "member-1": 0,
          },
        },
      },
    },
    {
      replay: "voted",
      label: "Repeated vote",
      expect: {
        clean: true,
        exact: {
          "/state/namespaces/polls/guilds/workshop-guild/polls/poll-1/votes": {
            "member-1": 0,
          },
        },
      },
    },
    {
      name: "poll vote",
      args: { poll: "poll-1", answer: 2 },
      expect: {
        clean: true,
        exact: {
          "/state/namespaces/polls/guilds/workshop-guild/polls/poll-1/votes/member-1": 1,
        },
      },
    },
    {
      name: "poll close",
      actor: "stranger",
      args: { poll: "poll-1" },
      expect: { code: "GW_PERMISSION_DENIED" },
    },
    {
      name: "poll show",
      guildId: "other-guild",
      args: { poll: "poll-1" },
      expect: { code: "GW_POLL_MISSING" },
    },
    {
      name: "poll close",
      args: { poll: "poll-1" },
      expect: {
        clean: true,
        exact: {
          "/state/namespaces/polls/guilds/workshop-guild/polls/poll-1/closed": true,
        },
      },
    },
    {
      replay: "voted",
      label: "Stale vote",
      expect: { code: "GW_POLL_CLOSED" },
    },
  ],
};
export async function runPollScenarios(bot: Bot) {
  const report = await runScenario(bot, pollScenario);
  return report.steps.map((s) => ({
    name: s.label ?? s.name,
    passed: s.passed,
    detail: s.errors.join("; ") || "Passed",
  }));
}
