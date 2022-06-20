import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseCMSModule } from '@lenne.tech/ng-base/base-cms';

BaseCMSModule.config = {
  branding: true,
  logging: false,
  modelConfig: {
    user: {
      label: 'Nutzer',
      plural: 'Nutzer',
      excluded: false,
      restricted: true,
      roles: ['admin'],
    },
  },
  fieldConfig: {
    user: {
      email: {
        label: 'E-Mail',
        placeholder: '',
      },
      firstName: {
        label: 'Vorname',
      },
      lastName: {
        label: 'Nachname',
      },
      roles: {
        label: 'Rollen',
        roles: ['admin'],
      },
      username: {
        label: 'Benutzername',
      },
      password: {
        exclude: true,
        roles: ['admin'],
      },
    },
  },
};

@NgModule({
  declarations: [],
  imports: [CommonModule, BaseCMSModule],
})
export class CmsModule {}
