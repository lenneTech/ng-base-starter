import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  Injector,
  input,
  type OnInit,
  PLATFORM_ID,
  runInInjectionContext,
  signal,
  viewChild,
} from '@angular/core';
import { LtErrorTranslationService } from '@lenne.tech/ng-base';
import { injectLtAiChat, type LtAiChat, type LtAiMode, type LtAiPrompt } from '@lenne.tech/ng-base/ai';
import { HlmButton, HlmTextarea, LtNotice } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEraser, lucideSend, lucideSparkles, lucideSquare } from '@ng-icons/lucide';

import { AiConnectionPicker } from './ai-connection-picker';
import { AiContextWindow } from './ai-context-window';
import { AiMessage } from './ai-message';
import { AiPromptPicker } from './ai-prompt-picker';
import { AiTokenBar } from './ai-token-bar';
import { AiUsageBadge } from './ai-usage-badge';
import { appendPromptToDraft } from './chat-draft';

/** Local history cap, so a long-running chat tab does not grow `messages` without bound (the server keeps the conversation). */
const MAX_MESSAGES = 100;

/**
 * The AI chat: a chat session (`injectLtAiChat`: streaming, conversation, budget, confirmation) wired to a message list
 * and an input. Self-contained and reusable.
 *
 * - ENTER sends, SHIFT+ENTER adds a line; the input grows with its content and is locked while an answer streams.
 * - The list follows the latest message while it streams (smooth, unless the user prefers reduced motion) and is a
 *   live region that announces a turn once it is complete (`aria-busy` while it streams).
 * - Each turn sends the current page URL as client metadata (untrusted, capped server-side).
 */
@Component({
  imports: [AiConnectionPicker, AiContextWindow, AiMessage, AiPromptPicker, AiTokenBar, AiUsageBadge, HlmButton, HlmTextarea, LtNotice, NgIcon],
  providers: [provideIcons({ lucideEraser, lucideSend, lucideSparkles, lucideSquare })],
  selector: 'app-ai-chat',
  host: { class: 'flex min-h-0 flex-col gap-3' },
  templateUrl: './ai-chat.html',
})
export class AiChat implements OnInit {
  /** Continue an existing conversation. */
  readonly conversationId = input<string>();
  /** Execution mode of every turn (default: the backend's `ai.defaultMode`). */
  readonly mode = input<LtAiMode>();
  /** Show the user's connection picker (default `true`). */
  readonly showConnectionPicker = input(true, { transform: booleanAttribute });

  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly textarea = viewChild.required<ElementRef<HTMLTextAreaElement>>('textarea');

  /**
   * The chat session, created in `ngOnInit`: `injectLtAiChat` reads `conversationId` and `mode` once, and signal inputs
   * are not set yet while field initializers run.
   */
  protected chat!: LtAiChat;
  protected readonly draft = signal('');
  protected readonly canSend = computed(() => !!this.draft().trim());
  protected readonly errorText = computed(() => {
    const error = this.chat.error();
    return error ? this.errors.translateError(error) : null;
  });

  ngOnInit(): void {
    runInInjectionContext(this.injector, () => {
      this.chat = injectLtAiChat({
        conversationId: this.conversationId(),
        maxMessages: MAX_MESSAGES,
        metadata: () => ({ url: this.isBrowser ? this.document.location.href : undefined }),
        mode: this.mode(),
      });

      // Follow the latest message. Every streamed token replaces the messages array, so this runs per token; it only
      // scrolls, so the work stays constant however long the conversation gets.
      afterRenderEffect(() => {
        void this.chat.messages();
        const list = this.list().nativeElement;
        list.scrollTo?.({ behavior: this.prefersReducedMotion() ? 'auto' : 'smooth', top: list.scrollHeight });
      });

      // Fallback for browsers without `field-sizing: content` (the textarea's own auto-grow): size it to its content.
      afterRenderEffect(() => {
        void this.draft();
        const textarea = this.textarea().nativeElement;
        if (typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')) {
          return;
        }
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      });
    });
  }

  protected onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** ENTER without modifiers sends (the `keydown.enter` binding excludes SHIFT+ENTER); not while an IME composes. */
  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).isComposing) {
      return;
    }
    event.preventDefault();
    void this.submit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  protected insertPrompt(prompt: LtAiPrompt): void {
    this.draft.update((draft) => appendPromptToDraft(draft, prompt.content));
    this.focusInput();
  }

  protected stop(): void {
    this.chat.stop();
    this.focusInput();
  }

  protected clear(): void {
    this.chat.clear();
    this.focusInput();
  }

  protected async confirm(): Promise<void> {
    await this.chat.confirm();
  }

  private async submit(): Promise<void> {
    const text = this.draft();
    if (!text.trim() || this.chat.streaming()) {
      return;
    }
    this.draft.set('');
    await this.chat.send(text);
    // The input was locked while the answer streamed; give it the focus back for the next message.
    this.focusInput();
  }

  /** Focus the input after the next render (it may just have been re-enabled); a turn can end after the chat is gone. */
  private focusInput(): void {
    if (this.destroyRef.destroyed) {
      return;
    }
    afterNextRender(() => this.textarea().nativeElement.focus(), { injector: this.injector });
  }

  private prefersReducedMotion(): boolean {
    return this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }
}
