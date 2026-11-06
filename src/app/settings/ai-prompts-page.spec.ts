/**
 * Which prompts the prompt pages ask the API for. The management page (`/app/settings/ai-prompts`) lists disabled
 * prompts too (`load({ includeDisabled: true })`, nest-server 12.7.0 `GET /ai/prompts?includeDisabled=true`), so their
 * "inaktiv" badge and the "Aktiv" switch take effect; the chat's prompt picker asks without the option and shows only
 * `enabledPrompts()`, also while the shared list holds the disabled ones of the management page.
 */
import { signal, type Type } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { type LtAiPrompt, LtAiPlaceholdersService, LtAiPromptsService } from '@lenne.tech/ng-base/ai';
import { LtAuthService } from '@lenne.tech/ng-base/auth';

import { AiPromptPicker } from '../ai/chat/ai-prompt-picker';
import { AiPromptsPage } from './ai-prompts-page';

const ACTIVE = { content: 'Fasse zusammen', enabled: true, id: 'p1', name: 'Zusammenfassung', scope: 'user' } as unknown as LtAiPrompt;
const DISABLED = { content: 'Alt', enabled: false, id: 'p2', name: 'Abgeschaltet', scope: 'user' } as unknown as LtAiPrompt;

function fakePrompts() {
  return {
    create: vi.fn(),
    enabledPrompts: signal([ACTIVE]),
    error: signal(null),
    load: vi.fn(async () => undefined),
    loading: signal(false),
    prompts: signal([ACTIVE, DISABLED]),
    remove: vi.fn(),
    update: vi.fn(),
  };
}

async function render<T>(component: Type<T>, prompts: ReturnType<typeof fakePrompts>): Promise<ComponentFixture<T>> {
  TestBed.configureTestingModule({
    providers: [
      { provide: LtAiPromptsService, useValue: prompts },
      { provide: LtAiPlaceholdersService, useValue: { error: signal(null), load: vi.fn(async () => undefined), loading: signal(false), placeholders: signal([]) } },
      { provide: LtAuthService, useValue: { isAdmin: signal(false), user: signal({ id: 'u1', roles: [] }) } },
      { provide: LtErrorTranslationService, useValue: { translateError: (message: string) => message } },
      { provide: LtToastService, useValue: { show: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  return fixture;
}

describe('which prompts the prompt pages load', () => {
  it('the management page asks for the disabled prompts too', async () => {
    const prompts = fakePrompts();
    await render(AiPromptsPage, prompts);
    expect(prompts.load).toHaveBeenCalledWith({ includeDisabled: true });
  });

  it('the chat picker asks without the option and offers only enabled prompts', async () => {
    const prompts = fakePrompts();
    const fixture = await render(AiPromptPicker, prompts);
    expect(prompts.load).toHaveBeenCalledWith();
    const groups = (fixture.componentInstance as unknown as { groups: () => { prompts: LtAiPrompt[] }[] }).groups();
    expect(groups.flatMap((group) => group.prompts).map((prompt) => prompt.id)).toEqual(['p1']);
  });
});
