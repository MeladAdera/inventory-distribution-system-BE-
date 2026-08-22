import { Module } from '@nestjs/common';
import { ShiftsController } from './controllers/shifts.controller';
import { ShiftsService } from './services/shifts.service';
import { ShiftsRepository } from './repositories/shifts.repository';
import { UsersModule } from '../users/users.module';

@Module({
  // For UsersRepository: the rule that an assignee is an active employee of
  // this shop is checked against the users table, which that module owns.
  imports: [UsersModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftsRepository],
  // ShiftsService is exported for its session resolvers: receipts, customers
  // and suppliers each need to stamp money with the shift it moved in, and the
  // rule for which shift that is belongs here rather than in each of them.
  exports: [ShiftsRepository, ShiftsService],
})
export class ShiftsModule {}
