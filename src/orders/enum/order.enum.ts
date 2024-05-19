import { OrderStatus } from "@prisma/client";

export const OrderStatusList = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
    OrderStatus.DELIVERED,
];