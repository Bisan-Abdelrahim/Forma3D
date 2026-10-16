
const axes = ['x', 'y', 'z'];

// ===============================
// JSON VALIDATION HELPERS
// ===============================

function checkKeys(value, required, optional = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new Error('Expected one JSON object.');
  }

  const allowed = [...required, ...optional];

  if (
    required.some(key => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(key => !allowed.includes(key))
  ) {
    throw new Error('Missing or unexpected command fields.');
  }
}

function checkVector(value, positive = false) {
  checkKeys(value, [], axes);

  if (Object.keys(value).length === 0) {
    throw new Error('At least one axis is required.');
  }

  for (const number of Object.values(value)) {
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      Math.abs(number) > 10000 ||
      (positive && number < 0.001)
    ) {
      throw new Error('Invalid coordinates or scale.');
    }
  }
}

// ===============================
// VALIDATE AI COMMAND
// ===============================

export function validateCommand(command) {
  checkKeys(command, ['action'], [
    'shape',
    'dimensions',
    'position',
    'target',
    'rotation',
    'scale'
  ]);

  // CREATE
  if (command.action === 'create') {
    checkKeys(command, ['action', 'shape'], [
      'dimensions',
      'position'
    ]);

    const dimensionFields = {
      cube: ['width', 'height', 'depth'],
      sphere: ['radius'],
      cylinder: ['radius', 'height']
    };

    if (!Object.hasOwn(dimensionFields, command.shape)) {
      throw new Error('Unsupported shape.');
    }

    if (command.position !== undefined) {
      checkVector(command.position);
    }

    if (command.dimensions !== undefined) {
      checkKeys(
        command.dimensions,
        [],
        dimensionFields[command.shape]
      );

      for (const number of Object.values(command.dimensions)) {
        if (
          typeof number !== 'number' ||
          !Number.isFinite(number) ||
          number < 0.001 ||
          number > 10000
        ) {
          throw new Error('Invalid dimensions.');
        }
      }
    }

  } else {

    // MOVE / ROTATE / SCALE / DELETE
    const fields = {
      move: 'position',
      rotate: 'rotation',
      scale: 'scale',
      delete: null
    };

    if (!Object.hasOwn(fields, command.action)) {
      throw new Error('Unsupported action.');
    }

    const field = fields[command.action];

    checkKeys(command, [
      'action',
      'target',
      ...(field ? [field] : [])
    ]);

    if (
      command.target !== 'selected' &&
      !(
        Number.isSafeInteger(command.target) &&
        command.target > 0
      )
    ) {
      throw new Error('Invalid target.');
    }

    if (field) {
      checkVector(
        command[field],
        field === 'scale'
      );
    }
  }

  return command;
}

// ===============================
// AI SYSTEM PROMPT
// ===============================

const systemPrompt = `
You are the command interpreter for Forma3D,
a beginner-friendly 3D editor.

Your only task is to convert the user's
natural-language design instruction into
exactly ONE valid JSON command.

Return JSON only.
Never return JavaScript.
Never return Markdown.
Never return explanations.
Never return an array.
Never include extra fields.

SUPPORTED ACTIONS:
create, move, rotate, scale, delete.

SUPPORTED SHAPES:
cube, sphere, cylinder.

VALID COMMAND EXAMPLES:

CREATE CUBE:
{"action":"create","shape":"cube","dimensions":{"width":4,"height":2,"depth":3}}

CREATE SPHERE:
{"action":"create","shape":"sphere","dimensions":{"radius":2}}

CREATE CYLINDER:
{"action":"create","shape":"cylinder","dimensions":{"radius":1,"height":3}}

MOVE:
{"action":"move","target":"selected","position":{"x":3}}

ROTATE:
{"action":"rotate","target":"selected","rotation":{"y":90}}

SCALE:
{"action":"scale","target":"selected","scale":{"x":2,"y":2,"z":2}}

DELETE:
{"action":"delete","target":"selected"}

IMPORTANT RULES:

1. Return exactly one JSON object.

2. Only use supported actions and shapes.

3. Create dimensions and position are optional.

4. Missing dimensions use editor defaults.

5. Transform vectors may contain x, y, or z.

6. Missing axes keep their existing values.

7. Movement uses absolute coordinates.

8. Rotation uses degrees and absolute angles.

9. Scale uses absolute scale factors.

10. Target must be "selected" or an existing
numeric object ID from the scene context.

11. Use scene context to identify existing objects.

12. Resolve relative instructions using scene context.

13. Do not invent object IDs.

14. Do not invent unsupported operations.

15. All numbers must be finite and within valid limits.

IMPORTANT OUTPUT RULES:

- Scene context is provided for reference only.
- Scene context is NOT part of the output.
- NEVER copy scene context into the response.
- NEVER include "scene" in the JSON output.
- NEVER include "selectedId" in the JSON output.
- NEVER include object lists in the JSON output.
- Return ONLY fields allowed for the chosen action.
- Do not add extra properties.

For DELETE, return exactly:
{"action":"delete","target":"selected"}

If the user explicitly refers to an existing object
using its name or ID, resolve its numeric ID from
scene context and use that ID as target.

For example:
{"action":"delete","target":2}

Do not add any other fields to DELETE commands.

For unsupported, ambiguous, or multiple actions,
return exactly:

{"error":"Please request one supported action."}
`;

// ===============================
// OLLAMA API REQUEST
// ===============================

export async function requestCommand(instruction, sceneContext) {

  // Send context separately from the user instruction.
  // Context is for reference, not for copying into JSON.

  const response = await fetch(
    'http://localhost:11434/api/chat',
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      signal: AbortSignal.timeout(120000),

      body: JSON.stringify({
        model: 'llama3.2',

        stream: false,

        format: 'json',

        options: {
          temperature: 0
        },

        messages: [
          {
            role: 'system',
            content:
              systemPrompt +
              '\n\nScene context (reference only):\n' +
              JSON.stringify(sceneContext)
          },

          {
            role: 'user',
            content: instruction
          }
        ]
      })
    }
  );

  // ===============================
  // CHECK API RESPONSE
  // ===============================

  if (!response.ok) {
    throw new Error(
      `Ollama error: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const content = data.message?.content;

  // Debugging: inspect the exact AI response
  console.log('Ollama raw response:', content);

  if (
    typeof content !== 'string' ||
    content.length > 10000
  ) {
    throw new Error('Invalid AI response.');
  }

  // ===============================
  // PARSE JSON
  // ===============================

  let command;

  try {
    command = JSON.parse(content);
  } catch {
    throw new Error('AI returned invalid JSON.');
  }

  // ===============================
  // HANDLE UNSUPPORTED REQUESTS
  // ===============================

  if (
    command &&
    typeof command === 'object' &&
    !Array.isArray(command) &&
    typeof command.error === 'string'
  ) {
    throw new Error(
      'AI could not interpret this instruction.'
    );
  }

  // ===============================
  // VALIDATE BEFORE EXECUTION
  // ===============================

  return validateCommand(command);
}
