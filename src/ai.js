
const actions = [
  'create',
  'move',
  'rotate',
  'scale',
  'delete',
  'skew',
  'taper',
  'bend'
];

const shapes = ['cube', 'sphere', 'cylinder'];

const own = (object, key) => Object.hasOwn(object, key);

// Validate that the value is a JSON object
function record(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new Error('Expected one JSON object.');
  }
}

// Validate required and allowed fields
function keys(value, required, optional = []) {
  record(value);

  const allowed = [...required, ...optional];

  if (
    required.some(key => !own(value, key)) ||
    Object.keys(value).some(key => !allowed.includes(key))
  ) {
    throw new Error(
      'Missing or unexpected command fields.'
    );
  }
}

// Validate 3D vectors
function vector(value, positive = false) {
  keys(value, ['x', 'y', 'z']);

  if (
    Object.values(value).some(
      n =>
        typeof n !== 'number' ||
        !Number.isFinite(n) ||
        Math.abs(n) > 10000 ||
        (positive && n < 0.001)
    )
  ) {
    throw new Error(
      'Invalid coordinates: use finite numbers within ±10000; sizes/scales must be at least 0.001.'
    );
  }
}

// Validate AI commands
export function validateCommand(command) {
  record(command);

  if (!actions.includes(command.action)) {
    throw new Error('Unsupported action.');
  }

  // CREATE
  if (command.action === 'create') {
    keys(
      command,
      ['action', 'shape'],
      ['dimensions', 'position']
    );

    if (!shapes.includes(command.shape)) {
      throw new Error('Unsupported shape.');
    }

    if (own(command, 'position')) {
      vector(command.position);
    }

    if (own(command, 'dimensions')) {
      const fields =
        command.shape === 'cube'
          ? ['width', 'height', 'depth']
          : command.shape === 'sphere'
            ? ['radius']
            : ['radius', 'height'];

      keys(command.dimensions, fields);

      for (const n of Object.values(command.dimensions)) {
        if (
          typeof n !== 'number' ||
          !Number.isFinite(n) ||
          n < 0.001 ||
          n > 10000
        ) {
          throw new Error('Invalid dimensions.');
        }
      }
    }

    return command;
  }

  // SKEW
  if (command.action === 'bend') {
    keys(command, ['action','target','axis','direction','angle']);
    if (!['x','y','z'].includes(command.axis) || !['x','y','z'].includes(command.direction) || command.axis === command.direction ||
        typeof command.angle !== 'number' || !Number.isFinite(command.angle) || Math.abs(command.angle) > 180) throw new Error('Invalid bend options');
  } else if (command.action === 'taper') {
    keys(command, ['action', 'target', 'axis', 'end', 'amount']);
    if (!['x', 'y', 'z'].includes(command.axis) || !['positive', 'negative'].includes(command.end) ||
        typeof command.amount !== 'number' || !Number.isFinite(command.amount) || command.amount < -0.95 || command.amount > 3) {
      throw new Error('Invalid taper: choose axis x/y/z, end positive/negative, amount -0.95..3.');
    }
  } else if (command.action === 'skew') {
    keys(command, [
      'action',
      'target',
      'axis',
      'relativeTo',
      'amount'
    ]);

    const validAxes = ['x', 'y', 'z'];

    if (
      !validAxes.includes(command.axis) ||
      !validAxes.includes(command.relativeTo) ||
      command.axis === command.relativeTo
    ) {
      throw new Error('Invalid skew axes.');
    }

    if (
      typeof command.amount !== 'number' ||
      !Number.isFinite(command.amount) ||
      Math.abs(command.amount) > 10
    ) {
      throw new Error(
        'Skew amount must be between -10 and 10.'
      );
    }

  } else {
    // MOVE / ROTATE / SCALE / DELETE
    const field = {
      move: 'position',
      rotate: 'rotation',
      scale: 'scale'
    }[command.action];

    keys(
      command,
      [
        'action',
        'target',
        ...(field ? [field] : [])
      ]
    );

    if (field) {
      vector(
        command[field],
        field === 'scale'
      );
    }
  }

  // Validate target object
  if (
    command.target !== 'selected' &&
    !(
      Number.isSafeInteger(command.target) &&
      command.target > 0
    )
  ) {
    throw new Error(
      'Target must be selected or an object ID.'
    );
  }

  return command;
}

// AI SYSTEM INSTRUCTIONS
const instructions = `
You translate design instructions into exactly ONE JSON command.
Never return code, markdown, or arrays.

Allowed commands (no extra keys):

CREATE CUBE:
{"action":"create","shape":"cube","dimensions":{"width":4,"height":2,"depth":3},"position":{"x":0,"y":0,"z":0}}

CREATE SPHERE:
{"action":"create","shape":"sphere","dimensions":{"radius":1}}

CREATE CYLINDER:
{"action":"create","shape":"cylinder","dimensions":{"radius":1,"height":2}}

Dimensions and position are optional for create.

MOVE:
{"action":"move","target":"selected","position":{"x":2,"y":0,"z":0}}

ROTATE:
{"action":"rotate","target":"selected","rotation":{"x":0,"y":90,"z":0}}

SCALE:
{"action":"scale","target":"selected","scale":{"x":2,"y":2,"z":2}}

DELETE:
{"action":"delete","target":"selected"}

BEND:
{"action":"bend","target":"selected","axis":"y","direction":"x","angle":90}
Bend along local axis toward a different local direction axis; angle is degrees -180..180.
Minimum-axis end stays fixed; cubes only. Subdivision is automatic.

TAPER:
{"action":"taper","target":"selected","axis":"y","end":"positive","amount":-0.5}
Taper scales both perpendicular dimensions linearly toward the selected local axis end.
The opposite end is fixed. Amount -0.5 halves the selected end; +1 doubles it.
Axis x/y/z; end positive/negative; amount -0.95..3. Cubes only.

SKEW:
{"action":"skew","target":"selected","axis":"x","relativeTo":"y","amount":0.5}

Skew modifies vertex positions using:
coordinate[axis] += amount * coordinate[relativeTo].

Valid axes are x, y, z.
The two axes must be different.
Skew amount must be between -10 and 10.
Skew is currently supported only for cubes.

RULES:
- All vectors require x, y, z.
- Rotation uses degrees.
- Move, rotate, and scale are absolute transformations.
- Scale is a factor relative to the base geometry.
- Target is "selected" or a numeric editor object ID.
- Resolve relative requests using scene context.
- Sizes and scales must be between 0.001 and 10000.
- Other coordinate values must be between -10000 and 10000.
- Generate exactly one supported action.
- Do not include extra JSON fields.

If the request is unsupported, ambiguous, or asks for multiple actions,
return:
{"error":"Please request one supported action."}
`;

// Send natural-language instructions to Ollama
export async function requestCommand(message, context) {
  const response = await fetch(
    'http://localhost:11434/api/chat',
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      signal: AbortSignal.timeout(120000),

      body: JSON.stringify({
        model:
          import.meta.env?.VITE_OLLAMA_MODEL ||
          'llama3.2',

        stream: false,

        format: 'json',

        options: {
          temperature: 0
        },

        messages: [
          {
            role: 'system',
            content: instructions
          },
          {
            role: 'user',
            content: JSON.stringify({
              instruction: message,
              scene: context
            })
          }
        ]
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Local AI returned HTTP ${response.status}. Check Ollama and the installed model.`
    );
  }

  const data = await response.json();

  if (
    typeof data.message?.content !== 'string' ||
    data.message.content.length > 10000
  ) {
    throw new Error('Invalid AI response.');
  }

  const command = JSON.parse(data.message.content);

  return validateCommand(command);
}
