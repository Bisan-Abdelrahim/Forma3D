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
    this.editor.listen(this.aiSend,
      'click',
      this.sendAIInstruction
    );
    this.editor.listen(this.aiInput,'keydown', event => {
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

  renderMessage(message) {
    if(this.disposed||this.editor.disposed)return;
    const container=document.querySelector('#ai-history');if(!container)return;
    const row=document.createElement('p');row.className=`ai-message ai-message-${message.role}`;
    row.textContent=`${message.role}${message.local?' (local, not stored)':''}: ${message.content}`;
    container.appendChild(row);container.scrollTop=container.scrollHeight;
  }
  async loadHistory(){
    if(!this.editor.projectId||!this.editor.conversations)return;
    const note=document.querySelector('#ai-history-note');
    try{
      const [history,models]=await Promise.all([this.editor.conversations.history(this.editor.projectId),this.editor.conversations.models()]);
      if(this.disposed||this.editor.disposed)return;
      document.querySelector('#ai-history')?.replaceChildren();
      history.messages.forEach(message=>this.renderMessage(message));
      if(note)note.textContent=`User messages are stored in Supabase. Assistant messages and execution records require a trusted backend. ${models.length} registered AI model(s).`;
    }catch(error){if(!this.disposed&&note)note.textContent=`Conversation history unavailable: ${error.message}. Local Ollama remains available.`;}
  }

  sendAIInstruction = async () => {
    if (this.disposed) return;
    if (this.editor.readOnly) { this.aiStatus.textContent='This project is read-only.'; return; }
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
      if(this.editor.projectId&&this.editor.conversations){
        try{const message=await this.editor.conversations.appendUser(this.editor.projectId,instruction,sceneContext);this.renderMessage(message);}
        catch(error){const note=document.querySelector('#ai-history-note');if(!this.disposed&&note)note.textContent=`Your message was not stored: ${error.message}. The local command can still run.`;}
      }
      if(this.disposed||this.editor.disposed)return;
      const command = await this.request(
        instruction,
        sceneContext,
        { signal: this.editor.events.signal }
      );

      if (this.disposed || this.editor.disposed) return;
      if (
        JSON.stringify(this.editor.history.takeSnapshot()) !== snapshot
      ) {
        throw new Error(
          'Scene changed while AI was processing. Please send again.'
        );
      }

      const result = this.editor.commands.executeCommand(command);
      this.renderMessage({role:'assistant',content:`Executed validated ${command.action} command in this browser.`,local:true});

      this.aiStatus.textContent =
        `Success: ${command.action}` +
        (result ? ` - ${result.name}` : '');

    } catch (error) {
      if (this.disposed || this.editor.disposed) return;

      this.aiStatus.textContent =
        `Error: ${error.message}`;

    } finally {
      this.aiBusy = false;
      if (!this.disposed && !this.editor.disposed) {
        this.aiSend.disabled = false;
        this.aiInput.disabled = false;
      }
    }
  };
}
