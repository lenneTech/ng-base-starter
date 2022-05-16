import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AuthGuard, BaseModule } from '@lenne.tech/ng-base';
import { ApolloModule } from 'apollo-angular';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { environment } from '../environments/environment';

@NgModule({
  declarations: [AppComponent],
  imports: [BaseModule.forRoot(environment), BrowserModule, AppRoutingModule],
  providers: [AuthGuard],
  bootstrap: [AppComponent],
})
export class AppModule {}
