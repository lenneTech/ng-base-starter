import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, TitleStrategy } from '@angular/router';

import { SITE_NAME } from './site';
import { AppTitleStrategy } from './title-strategy';

@Component({ template: '' })
class Empty {}

describe('AppTitleStrategy', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { component: Empty, path: '' },
          { component: Empty, path: 'login', title: 'Anmeldung' },
          { component: Empty, path: 'same', title: SITE_NAME },
        ]),
        { provide: TitleStrategy, useExisting: AppTitleStrategy },
      ],
    });
  });

  it('renders "<page> | <site>"', async () => {
    await TestBed.inject(Router).navigateByUrl('/login');
    expect(TestBed.inject(Title).getTitle()).toBe(`Anmeldung | ${SITE_NAME}`);
  });

  it('renders the site name alone for a route without a title, and never "<site> | <site>"', async () => {
    await TestBed.inject(Router).navigateByUrl('/');
    expect(TestBed.inject(Title).getTitle()).toBe(SITE_NAME);
    await TestBed.inject(Router).navigateByUrl('/same');
    expect(TestBed.inject(Title).getTitle()).toBe(SITE_NAME);
  });
});
