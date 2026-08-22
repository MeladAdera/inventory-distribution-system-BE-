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
  exports: [ShiftsRepository],
})
export class ShiftsModule {}
