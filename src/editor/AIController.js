import { requestCommand } from '../ai.js';

export class AIController {
  constructor(editor, request = requestCommand) {
      this.editor = editor;
      this.request = request;
  }

  bind() {
    this.aiInput = document.querySelector('#ai-instruction');
    this.aiSend = document.querySelector('#ai-send');
    this.aiStatus = document.querySelector('#ai-status');
    this.aiBusy = false;
    this.aiSend.addEventListener(
      'click',
      this.sendAIInstruction
    );
    this.aiInput.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        this.sendAIInstruction();
      }
    });
  }

  sendAIInstruction = async () => {
    const instruction = this.aiInput.value.trim();

    if (!instruction || instruction.length > 2000) {
      this.aiStatus.textContent =
        'Enter an instruction of 1–2000 characters.';
      return;
    }

    if (this.aiBusy) return;

    if (this.editor.mesh.editMode) {
      this.aiStatus.textContent =
        'Exit Edit Mode before using AI.';
      return;
    }

    if (this.editor.viewport.transformControls.dragging) {
      this.aiStatus.textContent =
        'Finish dragging first.';
      return;
    }

    this.aiBusy = true;
    this.aiSend.disabled = true;
    this.aiInput.disabled = true;

    this.aiStatus.textContent = 'Waiting for Ollama...';

    const sceneContext = this.editor.commands.getSceneContext();
    const snapshot = JSON.stringify(this.editor.history.takeSnapshot());

    try {
      const command = await this.request(
        instruction,
        sceneContext
      );

      if (
        JSON.stringify(this.editor.history.takeSnapshot()) !== snapshot
      ) {
        throw new Error(
          'Scene changed while AI was processing. Please send again.'
        );
      }

      const result = this.editor.commands.executeCommand(command);

      this.aiStatus.textContent =
        `Success: ${command.action}` +
        (result ? ` - ${result.name}` : '');

    } catch (error) {

      this.aiStatus.textContent =
        `Error: ${error.message}`;

    } finally {
      this.aiBusy = false;
      this.aiSend.disabled = false;
      this.aiInput.disabled = false;
    }
  };
}
