from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class TransactionCreate(BaseModel):
    title: str
    amount: Decimal
    category: str
    transaction_type: str
    transaction_date: date


class TransactionUpdate(TransactionCreate):
    pass


class TransactionOut(TransactionCreate):
    id: int
    user_id: int
    model_config = ConfigDict(from_attributes=True)
