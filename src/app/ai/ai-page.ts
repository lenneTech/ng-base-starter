import { Component } from '@angular/core';

import { AiChat } from './chat/ai-chat';

/**
 * `/app/ai` (client-rendered, any signed-in user while the API runs its AI module): the AI assistant. It can run
 * actions the backend secures; mutating or destructive ones wait for "Ausführung bestätigen".
 */
@Component({
  imports: [AiChat],
  selector: 'app-ai-page',
  templateUrl: './ai-page.html',
})
export class AiPage {}
