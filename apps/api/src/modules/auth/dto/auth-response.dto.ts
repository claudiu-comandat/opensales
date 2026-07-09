export interface AuthUserResponse {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'operator';
  };
}
