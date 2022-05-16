import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
// import {AuthGuard} from '@lenne.tech/ng-base';
import { environment } from '../environments/environment';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, AppRoutingModule],
  // providers: [AuthGuard],
  bootstrap: [AppComponent],
})
export class AppModule {}
