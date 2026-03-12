const Cart = {
    getItems: () => JSON.parse(localStorage.getItem('myCart')) || [],

    addItem: (product) => {
        let cart = Cart.getItems();
        // 檢查是否已存在
        const existingItem = cart.find(item => item.id === product.id);
        if (existingItem) {
            existingItem.qty = (existingItem.qty || 1) + 1;
        } else {
            product.qty = 1;
            cart.push(product);
        }
        localStorage.setItem('myCart', JSON.stringify(cart));
        alert(product.name + " 已加入購物車！");
    },

    getTotal: () => {
        return Cart.getItems().reduce((sum, p) => sum + (p.price * (p.qty || 1)), 0);
    }
};
