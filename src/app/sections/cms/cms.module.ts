import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseCMSModule } from '@lenne.tech/ng-base/base-cms';

BaseCMSModule.config = {
  branding: true,
  restrictedModels: [{ model: 'user', roles: ['admin'] }],
};

@NgModule({
  declarations: [],
  imports: [CommonModule, BaseCMSModule],
})
export class CmsModule {}
