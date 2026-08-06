import { Module } from '@nestjs/common';
import { SuppliersService } from './services/suppliers.service';
import { SuppliersController } from './controllers/suppliers.controller';
import { SuppliersRepository } from './repositories/suppliers.repository';
import { DebtsModule } from '../debts/debts.module';

@Module({
  imports: [DebtsModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SuppliersRepository],
  exports: [SuppliersRepository],
})
export class SuppliersModule {}
