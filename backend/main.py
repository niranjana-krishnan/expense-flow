from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone

from database import engine, Base, SessionLocal
import models
import schemas
import os
from dotenv import load_dotenv

load_dotenv()
Base.metadata.create_all(bind=engine)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str):
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str):
    return pwd_context.verify(password, password_hash)


def create_access_token(user_id: int):
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    error = HTTPException(
        status_code=401,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise error
        user_id = int(user_id)
    except (JWTError, ValueError):
        raise error

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise error

    return user


@app.get("/")
def home():
    return {"message": "ExpenseFlow API is running!"}


@app.post("/auth/register", response_model=schemas.AuthResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    email = user.email.lower().strip()

    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = models.User(
        name=user.name.strip(),
        email=email,
        password_hash=hash_password(user.password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "access_token": create_access_token(new_user.id),
        "token_type": "bearer",
        "user": new_user,
    }


@app.post("/auth/login", response_model=schemas.AuthResponse)
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    email = credentials.email.lower().strip()
    user = db.query(models.User).filter(models.User.email == email).first()

    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "user": user,
    }


@app.get("/auth/me", response_model=schemas.UserOut)
def me(current_user=Depends(get_current_user)):
    return current_user


@app.post("/transactions", response_model=schemas.TransactionOut)
def create_transaction(
    transaction: schemas.TransactionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    new_transaction = models.Transaction(
        user_id=current_user.id,
        title=transaction.title,
        amount=transaction.amount,
        category=transaction.category,
        transaction_type=transaction.transaction_type,
        transaction_date=transaction.transaction_date,
    )
    db.add(new_transaction)
    db.commit()
    db.refresh(new_transaction)
    return new_transaction


@app.get("/transactions")
def get_transactions(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == current_user.id)
        .order_by(models.Transaction.transaction_date.desc())
        .all()
    )


@app.delete("/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    transaction = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.id == transaction_id,
            models.Transaction.user_id == current_user.id,
        )
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db.delete(transaction)
    db.commit()
    return {"message": "Transaction deleted successfully"}


@app.put("/transactions/{transaction_id}", response_model=schemas.TransactionOut)
def update_transaction(
    transaction_id: int,
    updated_transaction: schemas.TransactionUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    transaction = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.id == transaction_id,
            models.Transaction.user_id == current_user.id,
        )
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    transaction.title = updated_transaction.title
    transaction.amount = updated_transaction.amount
    transaction.category = updated_transaction.category
    transaction.transaction_type = updated_transaction.transaction_type
    transaction.transaction_date = updated_transaction.transaction_date

    db.commit()
    db.refresh(transaction)
    return transaction
