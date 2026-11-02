const TECHNICAL = /\b(api|apis|server|servers|database|db|service|services|client|frontend|backend|auth|authentication|cache|queue|microservices?|endpoint|endpoints|deploy|deployment|infrastructure)\b/gi;
const PLANNING = /\b(roadmap|milestones?|deadlines?|sprints?|q[1-4]|launch|tasks?|todo|to do|done|release|phases?|backlog|owner|due)\b/gi;

export const SUGGESTION_SETS = Object.freeze({
  empty: ['sidekick.suggest.roadmap', 'sidekick.suggest.brainstorm', 'sidekick.suggest.kanbanNew'],
  technical: ['sidekick.suggest.architectureDiagram', 'sidekick.suggest.missingComponents', 'sidekick.suggest.explainRelations'],
  planning: ['sidekick.suggest.roadmapFromNotes', 'sidekick.suggest.missingMilestones', 'sidekick.suggest.kanbanFromTasks'],
  workflow: ['sidekick.suggest.explainWorkflow', 'sidekick.suggest.decisionPoints', 'sidekick.suggest.flowchart'],
  brainstorm: ['sidekick.suggest.groupIdeas', 'sidekick.suggest.themes', 'sidekick.suggest.userJourney'],
  general: ['sidekick.suggest.understand', 'sidekick.suggest.summarise', 'sidekick.suggest.persona']
});

const isText = (object) => ['textbox', 'i-text', 'text'].includes(String(object?.type || '').toLowerCase());

export const summariseBoardObjects = (objects = []) => {
  const texts = [];
  let stickies = 0;
  let connectors = 0;
  let meaningful = 0;
  for (const object of Array.isArray(objects) ? objects : []) {
    if (!object || object.metadata?.role === 'timestamp') continue;
    if (object.isConnector) {
      if (object.sourceShapeId || object.targetShapeId) connectors += 1;
      continue;
    }
    if (isText(object) && typeof object.text === 'string' && object.text.trim()) texts.push(object.text.trim());
    if (object.parentShapeId) continue;
    meaningful += 1;
    if (object.isStickyNote) stickies += 1;
  }
  return { texts, stickies, connectors, meaningful };
};

const matches = (pattern, text) => (text.match(pattern) || []).length;

export const classifyBoard = (objects = []) => {
  const summary = summariseBoardObjects(objects);
  if (!summary.meaningful) return 'empty';
  const text = summary.texts.join(' ');
  if (matches(TECHNICAL, text) >= 2) return 'technical';
  if (matches(PLANNING, text) >= 2) return 'planning';
  if (summary.connectors >= 2) return 'workflow';
  if (summary.stickies >= 4) return 'brainstorm';
  return 'general';
};

export const getSidekickSuggestions = (objects = []) => {
  const category = classifyBoard(objects);
  return { category, keys: SUGGESTION_SETS[category] };
};
