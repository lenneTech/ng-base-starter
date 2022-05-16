import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '@lenne.tech/ng-base';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'auth',
    pathMatch: 'full',
  },
  {
    path: 'main',
    loadChildren: () => import('./sections/main/main.module').then(m => m.MainModule),
    canActivateChild: [AuthGuard],
  },
  {
    path: 'auth',
    loadChildren: () => import('./sections/auth/auth.module').then(m => m.AuthModule),
  },
  {
    path: '**',
    redirectTo: '',
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
