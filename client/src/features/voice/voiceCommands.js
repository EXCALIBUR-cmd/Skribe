import { apiClient } from '../../api/apiClient.js';

export const VOICE_COMMAND_ACTIONS = Object.freeze(['create_text', 'create_sticky_note', 'create_shape']);

export const VOICE_COMMAND_SHAPES = Object.freeze(['rectangle', 'rounded_rectangle', 'circle', 'triangle', 'diamond', 'hexagon']);

export const VOICE_COMMAND_LIMITS = Object.freeze({
  transcript: 500,
  text: 500,
  label: 80
});

const SHAPE_NAMES = Object.freeze({
  rectangle: 'rectangle',
  rounded_rectangle: 'rounded rectangle',
  circle: 'circle',
  triangle: 'triangle',
  diamond: 'diamond',
  hexagon: 'hexagon'
});

const COMMAND_KEYS = Object.freeze({
  create_text: ['action', 'text'],
  create_sticky_note: ['action', 'text'],
  create_shape: ['action', 'shapeType', 'label']
});

const invalid = (code, message) => ({ valid: false, code, message });

export const validateVoiceCommand = (command) => {
  if (command === null || typeof command !== 'object' || Array.isArray(command)) {
    return invalid('INVALID_COMMAND', 'The command could not be read.');
  }

  if (!VOICE_COMMAND_ACTIONS.includes(command.action)) {
    return invalid('UNKNOWN_ACTION', 'That action is not supported by voice commands yet.');
  }

  const unexpectedKey = Object.keys(command).find((key) => !COMMAND_KEYS[command.action].includes(key));
  if (unexpectedKey) {
    return invalid('UNEXPECTED_FIELD', 'The command contained fields that voice commands cannot use.');
  }

  if (command.action === 'create_text' || command.action === 'create_sticky_note') {
    const text = typeof command.text === 'string' ? command.text.trim() : '';
    if (!text) {
      return invalid('MISSING_TEXT', 'The command did not include the text to write.');
    }
    if (text.length > VOICE_COMMAND_LIMITS.text) {
      return invalid('TEXT_TOO_LONG', `Text is limited to ${VOICE_COMMAND_LIMITS.text} characters.`);
    }
    return { valid: true, command: { action: command.action, text } };
  }

  if (!VOICE_COMMAND_SHAPES.includes(command.shapeType)) {
    return invalid('INVALID_SHAPE', 'That shape is not supported.');
  }

  if (command.label !== undefined && typeof command.label !== 'string') {
    return invalid('INVALID_LABEL', 'The shape label must be text.');
  }

  const label = typeof command.label === 'string' ? command.label.trim() : '';
  if (label.length > VOICE_COMMAND_LIMITS.label) {
    return invalid('LABEL_TOO_LONG', `Shape labels are limited to ${VOICE_COMMAND_LIMITS.label} characters.`);
  }

  return {
    valid: true,
    command: label
      ? { action: 'create_shape', shapeType: command.shapeType, label }
      : { action: 'create_shape', shapeType: command.shapeType }
  };
};

export const describeVoiceCommand = (command) => {
  if (!command) return '';
  if (command.action === 'create_text') return `text “${command.text}”`;
  if (command.action === 'create_sticky_note') return `sticky note “${command.text}”`;
  const shapeName = SHAPE_NAMES[command.shapeType] || 'shape';
  return command.label ? `${shapeName} labeled “${command.label}”` : shapeName;
};

const toRequestError = (raw) => {
  const rawMessage = typeof raw?.message === 'string' ? raw.message.trim() : '';
  if (raw?.name === 'CanceledError' || raw?.code === 'ERR_CANCELED' || rawMessage === 'canceled') {
    return { code: 'CANCELLED', message: 'The voice command was cancelled. No changes were made.' };
  }
  if (raw?.errors?.code) {
    return { code: raw.errors.code, message: rawMessage || 'The voice command could not be interpreted. No changes were made.' };
  }
  if (raw?.code === 'ECONNABORTED' || rawMessage.toLowerCase().includes('timeout')) {
    return { code: 'REQUEST_TIMEOUT', message: 'The server did not respond in time. No changes were made.' };
  }
  if (!rawMessage || rawMessage === 'Network Error') {
    return { code: 'NETWORK_ERROR', message: 'The server could not be reached. No changes were made.' };
  }
  return { code: 'REQUEST_FAILED', message: rawMessage };
};

export const requestVoiceCommandInterpretation = async (transcript, options = {}) => {
  const client = options.apiClient || apiClient;
  try {
    const response = await client.post('/voice-commands/interpret', { transcript }, {
      timeout: options.timeout ?? 20000,
      signal: options.signal
    });
    return response?.data || null;
  } catch (raw) {
    const mapped = toRequestError(raw);
    const err = new Error(mapped.message);
    err.code = mapped.code;
    throw err;
  }
};

const executeOnce = async (command, execute) => {
  let outcome;
  try {
    outcome = await execute(command);
  } catch (err) {
    return { status: 'error', code: 'CANVAS_ACTION_FAILED', message: err?.message || 'The canvas could not apply the command.' };
  }
  if (!outcome || outcome.success !== true) {
    return { status: 'error', code: 'CANVAS_ACTION_FAILED', message: outcome?.reason || 'The canvas could not apply the command.' };
  }
  return {
    status: 'executed',
    command,
    summary: `Created ${describeVoiceCommand(command)}`,
    objectId: outcome.objectId || null
  };
};

export const runVoiceCommand = async (transcript, { interpret, execute, signal } = {}) => {
  const instruction = typeof transcript === 'string' ? transcript.trim() : '';
  if (!instruction) {
    return { status: 'rejected', code: 'EMPTY_TRANSCRIPT', message: 'Say or type an instruction first.' };
  }
  if (instruction.length > VOICE_COMMAND_LIMITS.transcript) {
    return { status: 'rejected', code: 'TRANSCRIPT_TOO_LONG', message: `Instructions are limited to ${VOICE_COMMAND_LIMITS.transcript} characters.` };
  }
  if (signal?.aborted) {
    return { status: 'cancelled', message: 'The voice command was cancelled. No changes were made.' };
  }

  let interpretation;
  try {
    interpretation = await interpret(instruction, { signal });
  } catch (err) {
    if (signal?.aborted || err?.code === 'CANCELLED') {
      return { status: 'cancelled', message: 'The voice command was cancelled. No changes were made.' };
    }
    return {
      status: 'error',
      code: err?.code || 'REQUEST_FAILED',
      message: err?.message || 'The voice command could not be interpreted. No changes were made.'
    };
  }

  if (signal?.aborted) {
    return { status: 'cancelled', message: 'The voice command was cancelled. No changes were made.' };
  }

  const result = interpretation?.result;
  if (!result || typeof result !== 'object') {
    return { status: 'rejected', code: 'MALFORMED_RESPONSE', message: 'The server returned an unreadable result. No changes were made.' };
  }

  if (result.status === 'rejected') {
    return {
      status: 'rejected',
      code: typeof result.code === 'string' ? result.code : 'REJECTED',
      message: typeof result.message === 'string' && result.message ? result.message : 'That command is not supported. No changes were made.'
    };
  }

  if (result.status === 'clarify') {
    const proposal = result.proposal ? validateVoiceCommand(result.proposal) : null;
    return {
      status: 'clarify',
      message: typeof result.message === 'string' && result.message ? result.message : 'Please say exactly what to create.',
      proposal: proposal && proposal.valid ? proposal.command : null
    };
  }

  if (result.status !== 'execute') {
    return { status: 'rejected', code: 'MALFORMED_RESPONSE', message: 'The server returned an unknown result. No changes were made.' };
  }

  const validation = validateVoiceCommand(result.command);
  if (!validation.valid) {
    return { status: 'rejected', code: validation.code, message: `${validation.message} No changes were made.` };
  }

  return executeOnce(validation.command, execute);
};

export const confirmVoiceCommandProposal = async (proposal, execute) => {
  const validation = validateVoiceCommand(proposal);
  if (!validation.valid) {
    return { status: 'rejected', code: validation.code, message: `${validation.message} No changes were made.` };
  }
  return executeOnce(validation.command, execute);
};

export default {
  VOICE_COMMAND_ACTIONS,
  VOICE_COMMAND_SHAPES,
  VOICE_COMMAND_LIMITS,
  validateVoiceCommand,
  describeVoiceCommand,
  requestVoiceCommandInterpretation,
  runVoiceCommand,
  confirmVoiceCommandProposal
};
