import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BASE_MODULE_CONFIG } from '@lenne.tech/ng-base/shared';
import { environment } from '../../../../../environments/environment';

import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{ provide: BASE_MODULE_CONFIG, useValue: environment }],
      declarations: [HeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
