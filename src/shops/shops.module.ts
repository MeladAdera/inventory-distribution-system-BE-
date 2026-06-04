import { Module } from '@nestjs/common';
import { ShopsService } from './services/shops.service';
import { ShopsController } from './controllers/shops.controller';
import { ShopsRepository } from './repositories/shops.repository';

@Module({
  controllers: [ShopsController],
  providers: [ShopsService, ShopsRepository],
  exports: [ShopsService],
})
export class ShopsModule {}
