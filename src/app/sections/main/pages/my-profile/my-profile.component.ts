import { Component } from '@angular/core';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-my-profile',
  templateUrl: './my-profile.component.html',
  styleUrls: ['./my-profile.component.scss'],
})
export class MyProfileComponent {
  config = {
    avatar: {
      label: 'Profilbild',
      type: 'Image',
      url: environment.restUrl,
      order: 1,
    },
  };
}
