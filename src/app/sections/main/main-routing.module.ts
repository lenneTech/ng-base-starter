import { RouterModule, Routes } from '@angular/router';
import { NgModule } from '@angular/core';
import { MainComponent } from './main.component';
import { MyProfileComponent } from './pages/my-profile/my-profile.component';
import { AuthGuard } from '@lenne.tech/ng-base';

const routes: Routes = [
  {
    path: '',
    component: MainComponent,
    children: [
      {
        path: 'profil',
        component: MyProfileComponent,
        pathMatch: 'full',
      },
      {
        path: 'cms',
        loadChildren: () => import('./sections/cms/cms.module').then(m => m.CmsModule),
        canActivateChild: [AuthGuard],
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MainRoutingModule {}
