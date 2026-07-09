export type Role = 'admin' | 'operator';

export interface Me {
  id: string;
  email: string;
  role: Role;
}
