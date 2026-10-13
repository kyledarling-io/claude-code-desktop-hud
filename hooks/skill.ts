// What Claude needs to know about the HUD, as one stable section of the system prompt. It is added
// only where the `hud` tool is offered, and cached with the prompt, so it is a constant: never built from the run, the
// board or a source's words. hooks/skill.test.ts pins it byte for byte; a change here is a change there, on purpose.
export const SKILL = [
  'The HUD (the hud tool) is a live strip above the prompt and a dashboard the person opens. You set its intent; it arranges itself.',
  '- Start a run for work that will take more than about a minute of tool calls (start, goal). Keep the title, goal and phases current, and finish with done or fail.',
  "- At a phase boundary (a new step, a changed goal), you may set mode (build, debug, review, research, plan) and focus: up to 3 slot ids that matter most now. The note beside each message lists the ids. Don't send mode or focus between boundaries.",
  "- Slots come from sources, the HUD's own and other plugins'. They fill themselves: never copy their figures into your widgets.",
  "- The person's pins, hides and mode switches win over yours. Urgent slots are the HUD's call.",
  '- Every number you send is observed or computed from observed numbers.',
].join('\n')
