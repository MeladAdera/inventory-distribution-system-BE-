import { Module } from '@nestjs/common';
import { ShopsService } from './services/shops.service';
import { ShopsController } from './controllers/shops.controller';

@Module({
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
