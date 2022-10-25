import { RouterModule, Routes } from '@angular/router';
import { NgModule } from '@angular/core';
import { AuthComponent } from './auth.component';
import {
  ForgotPasswordComponent,
  LoginComponent,
  RegisterComponent,
  SetPasswordComponent,
} from '@lenne.tech/ng-base/base-prototype';

const routes: Routes = [
  {
    path: '',
    component: AuthComponent,
    children: [
      {
        path: 'login',
        component: LoginComponent,
        data: {
          config: {
            redirectUrl: '/main',
            showPasswordForget: true,
            showRegister: true,
            logoUrl: '',
          },
        },
      },
      {
        path: 'registrieren',
        component: RegisterComponent,
      },
      {
        path: 'passwort-vergessen',
        component: ForgotPasswordComponent,
      },
      {
        path: 'passwort-setzen/:token',
        component: SetPasswordComponent,
      },
      {
        path: '',
        redirectTo: 'login',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuthRoutingModule {}
