import { Component, OnInit } from '@angular/core';
import { AuthService, BasicUser, ToastService, ToastType } from '@lenne.tech/ng-base/shared';
import { environment } from '../../../../../environments/environment';
import { Router } from '@angular/router';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent implements OnInit {
  user: BasicUser | null;
  env = environment;

  constructor(private authService: AuthService, private router: Router, private toastService: ToastService) {}

  ngOnInit(): void {
    this.authService.currentUserObservable.subscribe({
      next: user => {
        if (user) {
          this.user = BasicUser.map(user);
        } else {
          this.user = null;
        }
      },
    });
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/']);
    this.toastService.show(
      {
        id: 'logout-toast',
        type: ToastType.SUCCESS,
        title: 'Erfolgreich',
        description: 'Erfolgreich ausgeloggt',
      },
      2000
    );
  }
}
