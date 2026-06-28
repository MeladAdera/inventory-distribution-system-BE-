import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReceiptsService } from '../services/receipts.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateReceiptDto } from '../dto/create-receipt.dto';
import { ReceiptQueryDto } from '../dto/receipt-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@ApiTags('receipts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Create a receipt — batch-decreases inventory for multiple items atomically' })
  create(
    @Body() dto: CreateReceiptDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.receiptsService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'List receipts — admin sees all shops, others see own shop only. Filters: shopId, createdBy, fromDate, toDate' })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: ReceiptQueryDto,
  ) {
    return this.receiptsService.findAll(user, query);
  }

  @Get(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Get a single receipt with all its items' })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.receiptsService.findById(id, user);
  }
}
