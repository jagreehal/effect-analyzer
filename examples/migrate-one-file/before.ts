// A typical legacy service: async/await, try/catch, Promise.all, fetch,
// process.env, setTimeout, a throw, and class-based dependency injection.
//
// Nothing here imports Effect. This is the kind of file you'd actually
// find in an existing codebase — and exactly what the migration assistant
// is designed to map onto idiomatic Effect.

interface User {
  id: string;
  name: string;
  email: string;
}

interface Order {
  id: string;
  userId: string;
  total: number;
}

export class UserService {
  private readonly baseUrl = process.env.API_URL ?? 'https://api.example.com';

  async getUser(id: string): Promise<User> {
    try {
      const response = await fetch(`${this.baseUrl}/users/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user ${id}: ${response.status}`);
      }
      return (await response.json()) as User;
    } catch (error) {
      console.error('getUser failed', error);
      throw error;
    }
  }

  async getOrders(userId: string): Promise<Order[]> {
    const response = await fetch(`${this.baseUrl}/users/${userId}/orders`);
    return (await response.json()) as Order[];
  }
}

export class ReportService {
  constructor(private readonly users: UserService) {}

  // Fetch a user and their orders concurrently, then build a summary.
  async buildSummary(userId: string): Promise<string> {
    const [user, orders] = await Promise.all([
      this.users.getUser(userId),
      this.users.getOrders(userId),
    ]);

    const total = orders.reduce((sum, o) => sum + o.total, 0);

    // Pretend we flush analytics on a delay.
    setTimeout(() => {
      console.log(`flushed analytics for ${user.id}`);
    }, 1000);

    return `${user.name} has ${orders.length} orders worth ${total}`;
  }
}
