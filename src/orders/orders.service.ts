import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto';
import { firstValueFrom } from 'rxjs';
import { NATS_SERVICE } from 'src/config/services';


@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService');

  constructor(
    @Inject (NATS_SERVICE) private readonly client: ClientProxy
  ) {
    super();
  }


  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async create(createOrderDto: CreateOrderDto) {

    const productsIds = createOrderDto.items.map( product => product.productId );

    try {
      
      const products: any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate-products' }, productsIds)
      )
  
      const totalAmount = createOrderDto.items.reduce( (acc, orderItem) => {
        
        const price = products.find( product => product.id === orderItem.productId ).price;

        return price * orderItem.quantity;

      }, 0);

      const totalItems = createOrderDto.items.reduce( (acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      // data base transaction
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          items: {
            createMany: {
              data: createOrderDto.items.map( orderItem => ({
                price: products.find( product => product.id === orderItem.productId ).price,
                quantity: orderItem.quantity,
                productId: orderItem.productId,
              })),
            }
          }
        },
        include: {
          items: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          },

        }
      }, 
    );

      return {
        ...order,
        items: order.items.map( item => ({
          ...item,
          name: products.find( product => product.id === item.productId ).name
        }))
      };

    } catch (error) {
      this.logger.error(error.message);
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: error.message
      });
      
    }



   

  }

  async findAll(orderPaginationDto: OrderPaginationDto) {

    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;


    return {
      data: await this.order.findMany({
        skip: ( currentPage - 1 ) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil( totalPages / perPage )
      }
    }
  }
  

  async findOne(id: string) {

    const order = await this.order.findFirst({
      where: { id },
      include: {
        items: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          }
        }
      }
    });

    if ( !order ) {
      throw new RpcException({ 
        status: HttpStatus.NOT_FOUND, 
        message: `Order with id ${ id } not found`
      });
    }

    const productsIds = order.items.map( item => item.productId );

    const products: any[] = await firstValueFrom(
      this.client.send({ cmd: 'validate-products' }, productsIds)
    )

    return {
      ...order,
      items: order.items.map( item => ({
        ...item,
        name: products.find( product => product.id === item.productId ).name
      }))
    };

  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {

    const { id, status } = changeOrderStatusDto;

    const order = await this.findOne(id);
    if ( order.status === status ) {
      return order;
    }

    return this.order.update({
      where: { id },
      data: { status: status }
    });


  }



}