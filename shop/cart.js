const Cart = {
    // 取得購物車資料
    getItems: () => JSON.parse(localStorage.getItem('myCart') || '[]'),
    
    // 加入商品
    addItem: (id, name, price, maxQuantity) => {
        let items = Cart.getItems();
        const existingItem = items.find(item => item.id === id);
        
        // 檢查購物車內該商品數量，若已達庫存上限則阻止
        const currentQtyInCart = existingItem ? existingItem.quantity : 0;
        if (currentQtyInCart >= maxQuantity) {
            alert('❌ 此商品庫存不足，無法再新增！');
            return;
        }

        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            items.push({ id, name, price, quantity: 1 });
        }

        localStorage.setItem('myCart', JSON.stringify(items));
        alert('✅ 成功加入購物車！');
        
        // 更新 UI
        if (typeof updateCartUI === 'function') updateCartUI();
    },

    // 移除商品
    removeItem: (index) => {
        let items = Cart.getItems();
        items.splice(index, 1);
        localStorage.setItem('myCart', JSON.stringify(items));
        if (typeof updateCartUI === 'function') updateCartUI();
    },

    // 計算總金額
    getTotal: () => Cart.getItems().reduce((sum, item) => sum + (item.price * item.quantity), 0)
};
