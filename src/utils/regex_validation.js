const isValidPhoneNumber = (phoneNumber) => {
    const regex = /^0?[1-9]\d{6,13}$/;
    return regex.test(phoneNumber);
  };

  const isValidEmail = (email) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  };
  
  const isValidCustomerName = (name) => {
    return name && name.trim().length >= 2 && name.trim().length <= 30;
  };
  
  
  const isValidBillingAddress = (address) => {
    return !address || address.trim().length <= 100;
  };

  
  const isValidPassword = (password) => {
    const regex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    return regex.test(password);
  };
   
  const isPasswordConfirmPasswordMatch = (password, confirmPassword) => {
    return password === confirmPassword;
  };

const isValidUsername = (username) => {
  return username && username.trim().length >= 4 && username.trim().length <= 30;
};

const isValidItemName = (itemName) => {
  return itemName && itemName.trim().length >= 2 && itemName.trim().length <= 100;
};

const isValidUnitPrice = (unitPrice) => {
  return unitPrice !== null && unitPrice !== undefined && 
         typeof unitPrice === 'number' && unitPrice >= 0;
};

const isValidUnitMeasurement = (unitMeasurement) => {
  return unitMeasurement && unitMeasurement.trim().length >= 1 && 
         unitMeasurement.trim().length <= 20;
};

const isValidObjectId=(id)=> {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

  
  export { isValidPhoneNumber, isValidEmail, isValidCustomerName, isValidBillingAddress, isValidPassword,isPasswordConfirmPasswordMatch,
     isValidUsername,isValidItemName,isValidUnitPrice,isValidUnitMeasurement,isValidObjectId };