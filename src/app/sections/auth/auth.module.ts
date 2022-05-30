import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthRoutingModule } from './auth-routing.module';
import { AuthComponent } from './auth.component';
import { BasePrototypeModule } from '@lenne.tech/ng-base/base-prototype';
import { BaseComponentsModule } from '@lenne.tech/ng-base/base-components';

@NgModule({
  declarations: [AuthComponent],
  imports: [CommonModule, AuthRoutingModule, BasePrototypeModule, BaseComponentsModule],
})
export class AuthModule {}
