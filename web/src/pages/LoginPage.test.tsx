import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { AuthProvider } from '../auth';
import { LoginPage } from './LoginPage';

const { me, login, register } = vi.hoisted(() => ({ me: vi.fn(), login: vi.fn(), register: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { me, login, register },
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Dashboard home</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const user = { id: 1, email: 'me@example.com', slug: 'abc' };

beforeEach(() => {
  me.mockReset().mockRejectedValue(new ApiError('Not signed in', 401));
  login.mockReset();
  register.mockReset();
});

describe('LoginPage', () => {
  it('shows the sign-in form to signed-out visitors', async () => {
    renderLogin();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('signs in and moves to the dashboard', async () => {
    login.mockResolvedValue(user);
    const typist = userEvent.setup();
    renderLogin();

    await typist.type(await screen.findByLabelText('Email'), 'me@example.com');
    await typist.type(screen.getByLabelText('Password'), 'correct horse battery');
    await typist.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).toHaveBeenCalledWith('me@example.com', 'correct horse battery');
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
  });

  it('shows the server message when credentials are wrong and stays on the form', async () => {
    login.mockRejectedValue(new ApiError('Invalid email or password', 401));
    const typist = userEvent.setup();
    renderLogin();

    await typist.type(await screen.findByLabelText('Email'), 'me@example.com');
    await typist.type(screen.getByLabelText('Password'), 'wrong-password');
    await typist.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByText('Dashboard home')).not.toBeInTheDocument();
  });

  it('switches to registration, asks for a strong password and creates the account', async () => {
    register.mockResolvedValue(user);
    const typist = userEvent.setup();
    renderLogin();

    await typist.click(await screen.findByRole('button', { name: /create an account/i }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('minlength', '10');
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('autocomplete', 'new-password');

    await typist.type(screen.getByLabelText('Email'), 'me@example.com');
    await typist.type(screen.getByLabelText(/^Password/), 'correct horse battery');
    await typist.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).toHaveBeenCalledWith('me@example.com', 'correct horse battery');
    expect(login).not.toHaveBeenCalled();
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
  });

  it('redirects an already signed-in user straight to the dashboard', async () => {
    me.mockResolvedValue(user);
    renderLogin();
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
  });
});
